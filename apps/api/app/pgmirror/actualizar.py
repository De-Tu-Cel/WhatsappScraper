"""Operadores de actualización de Mongo aplicados a un documento en Python.

Es el motor de la fase de escrituras (docs/MIGRACION_POSTGRES.md, «Postgres fuente de verdad»): con
él Postgres podrá aplicar un update_one/update_many/find_one_and_update por su cuenta. Antes de que
mande, el modo «sombra de escrituras» compara cada resultado contra lo que dejó Mongo, y
tests/test_pgmirror_actualizar.py lo compara contra Mongo 7 real.

Solo lo que la app usa (inventario del 2026-10-21): $set, $unset, $inc, $push ($each, $slice),
$addToSet ($each), $pull (valor o {"$in": [...]}), $max, $min y $setOnInsert. Lo demás levanta
NoSoportado y la escritura sigue en Mongo: nunca adivina.

Como Mongo 5+: los campos se procesan en orden lexicográfico de su ruta, así que los campos nuevos
se agregan al final del documento (o del subdocumento) en ese orden; los que ya existían conservan
su lugar. La igualdad entre valores es la de BSON (1 == 1.0; un subdocumento solo es igual a otro
con las mismas llaves en el mismo orden).
"""
import copy
from datetime import datetime
from decimal import Decimal

from bson import ObjectId
from bson.decimal128 import Decimal128

from app.pgmirror import codec


class NoSoportado(Exception):
    pass


class ErrorDeMongo(Exception):
    """Lo que en Mongo también sería un error (p. ej. $inc sobre un texto)."""


OPERADORES = ("$set", "$unset", "$inc", "$push", "$addToSet", "$pull", "$max", "$min", "$setOnInsert")
_FALTA = object()


def _partes(ruta, indices: bool = False) -> list[str]:
    if not isinstance(ruta, str) or not ruta:
        raise NoSoportado(f"ruta {ruta!r}")
    partes = ruta.split(".")
    # Índices: solo los que salen del posicional `$` ya resuelto (_resolver_posicional).
    if any(not p or p.startswith("$") or (p.isdigit() and not indices) for p in partes):
        raise NoSoportado(f"ruta {ruta!r}")
    return partes


def _clave_bson(v):
    """Para comparar como BSON: números por valor y lo demás por su forma exacta (orden de llaves incluido)."""
    if isinstance(v, bool):
        return ("b", v)
    if isinstance(v, (int, float)):
        return ("n", Decimal(repr(v)) if isinstance(v, float) else Decimal(v))
    if isinstance(v, Decimal128):
        raise NoSoportado("Decimal128")
    return ("v", codec.encode_doc({"v": v}))


def _iguales(a, b) -> bool:
    return _clave_bson(a) == _clave_bson(b)


# Orden de tipos de BSON para $max/$min (el mismo que usa el orden de sqlfilter).
_RANGO = [(type(None), 1), (bool, 8), ((int, float), 2), (str, 3), (dict, 4), (list, 5), (bytes, 6),
          (ObjectId, 7), (datetime, 9)]


def _rango(v) -> int:
    for tipo, r in _RANGO:
        if isinstance(v, tipo):
            return r
    raise NoSoportado(f"comparar {type(v).__name__}")


def _menor(a, b) -> bool:
    ra, rb = _rango(a), _rango(b)
    if ra != rb:
        return ra < rb
    if ra in (4, 5, 6):
        raise NoSoportado("$max/$min entre subdocumentos o arreglos")
    if ra == 7:
        return str(a) < str(b)
    if ra == 9:
        return _ms(a) < _ms(b)
    return a < b


def _ms(dt: datetime) -> int:
    """Mongo guarda las fechas al milisegundo y en UTC (las naive son UTC)."""
    from bson.datetime_ms import _datetime_to_millis
    return _datetime_to_millis(dt)


def _numero(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


# ── árbol de cambios ──────────────────────────────────────────────────────────
def _arbol(update: dict, insertando: bool, indices: bool = False) -> dict:
    """{campo: subárbol | (operador, valor)}; dos operadores sobre la misma ruta (o una dentro de la
    otra) son un conflicto, como en Mongo."""
    if not isinstance(update, dict) or not update:
        raise NoSoportado("update vacío o no es dict")
    raiz: dict = {}
    for op, campos in update.items():
        if op not in OPERADORES:
            raise NoSoportado(op if isinstance(op, str) and op.startswith("$") else "documento de reemplazo")
        if not isinstance(campos, dict):
            raise ErrorDeMongo(f"{op} necesita un documento")
        for ruta, valor in campos.items():
            partes = _partes(ruta, indices)
            nodo = raiz
            for p in partes[:-1]:
                hijo = nodo.setdefault(p, {})
                if isinstance(hijo, tuple):
                    raise ErrorDeMongo(f"Updating the path '{ruta}' would create a conflict")
                nodo = hijo
            if partes[-1] in nodo:
                raise ErrorDeMongo(f"Updating the path '{ruta}' would create a conflict")
            # $setOnInsert cuenta para los conflictos aunque no se esté insertando (como en Mongo).
            nodo[partes[-1]] = ("$set" if insertando else "$nada", valor) if op == "$setOnInsert" else (op, valor)
    return raiz


def _aplicar_en(obj: dict, arbol: dict):
    for campo in sorted(arbol):  # orden lexicográfico, como Mongo 5+
        cambio = arbol[campo]
        if isinstance(cambio, dict):
            actual = obj.get(campo, _FALTA)
            if actual is _FALTA:
                if _sin_efecto(cambio, ("$unset", "$pull", "$nada")):
                    continue  # quitar algo de un campo que no existe: no hace nada
                obj[campo] = {}
                actual = obj[campo]
            elif isinstance(actual, list) and cambio and all(k.isdigit() for k in cambio):
                _aplicar_en_lista(actual, cambio)  # un elemento por su índice (el posicional `$`)
                continue
            elif not isinstance(actual, dict):
                if _sin_efecto(cambio, ("$unset", "$nada")):
                    continue  # $unset dentro de algo que no es documento: no hace nada
                # $set/$pull/… a través de un escalar: Mongo responde «Cannot use the part … to traverse».
                raise ErrorDeMongo(f"no se puede recorrer {campo!r}: no es un documento")
            _aplicar_en(actual, cambio)
            continue
        op, valor = cambio
        actual = obj.get(campo, _FALTA)
        if op == "$nada":
            continue
        if op == "$set":
            obj[campo] = copy.deepcopy(valor)
        elif op == "$unset":
            obj.pop(campo, None)
        elif op == "$inc":
            if not _numero(valor):
                raise ErrorDeMongo("$inc necesita un número")
            if actual is _FALTA:
                obj[campo] = valor
            elif _numero(actual):
                obj[campo] = actual + valor
            else:
                raise ErrorDeMongo(f"$inc sobre {type(actual).__name__}")
        elif op in ("$max", "$min"):
            if actual is _FALTA or (_menor(actual, valor) if op == "$max" else _menor(valor, actual)):
                obj[campo] = copy.deepcopy(valor)
        elif op in ("$push", "$addToSet"):
            obj[campo] = _agregar(op, actual, valor)
        elif op == "$pull":
            if actual is _FALTA:
                continue
            if not isinstance(actual, list):
                raise ErrorDeMongo("$pull sobre algo que no es arreglo")
            obj[campo] = [e for e in actual if not _quitar(e, valor)]


def _aplicar_en_lista(lista: list, arbol: dict):
    for indice, cambio in arbol.items():
        i = int(indice)
        if i >= len(lista):
            raise NoSoportado("índice fuera del arreglo")
        if isinstance(cambio, dict):
            if not isinstance(lista[i], dict):
                raise NoSoportado("ruta dentro de un elemento que no es documento")
            _aplicar_en(lista[i], cambio)
        elif cambio[0] == "$set":
            lista[i] = copy.deepcopy(cambio[1])
        else:
            raise NoSoportado(f"{cambio[0]} sobre un elemento de arreglo")


def _cumple_elemento(elemento, condicion) -> bool:
    """¿Este elemento del arreglo es el que el filtro encontró? condicion: (subruta | None, valor)."""
    sub, valor = condicion
    if sub is None:
        return _iguales(elemento, valor)
    actual = elemento
    for p in sub.split("."):
        if not isinstance(actual, dict) or p not in actual:
            return False
        actual = actual[p]
    return _iguales(actual, valor) or (isinstance(actual, list) and any(_iguales(e, valor) for e in actual))


def _condicion_posicional(filtro, arreglo: str):
    """La condición del filtro sobre los elementos de `arreglo`: «arreglo.sub: valor», «arreglo: valor» o
    «arreglo: {$elemMatch: {sub: valor}}». Más de una, u otro operador: no se adivina."""
    condiciones = []
    for campo, valor in (filtro or {}).items():
        if not isinstance(campo, str):
            continue
        if campo.startswith("$"):
            if any(isinstance(c, dict) and any(k == arreglo or k.startswith(arreglo + ".") for k in c)
                   for c in (valor if isinstance(valor, list) else [])):
                raise NoSoportado(f"posicional con {campo}")
            continue
        if campo != arreglo and not campo.startswith(arreglo + "."):
            continue
        sub = campo[len(arreglo) + 1:] or None
        if isinstance(valor, dict) and any(k.startswith("$") for k in valor):
            if set(valor) == {"$eq"}:
                valor = valor["$eq"]
            elif sub is None and set(valor) == {"$elemMatch"} and isinstance(valor["$elemMatch"], dict) \
                    and len(valor["$elemMatch"]) == 1 and not any(k.startswith("$") for k in valor["$elemMatch"]):
                sub, valor = next(iter(valor["$elemMatch"].items()))
                if isinstance(valor, dict):
                    raise NoSoportado("posicional con $elemMatch de operadores")
            else:
                raise NoSoportado(f"posicional con {sorted(valor)}")
        if isinstance(valor, (dict, list)):
            raise NoSoportado("posicional con un subdocumento o arreglo")
        condiciones.append((sub, valor))
    if len(condiciones) != 1:
        raise NoSoportado("posicional sin una sola condición sobre el arreglo")
    return condiciones[0]


def _resolver_posicional(doc: dict, update: dict, filtro) -> tuple[dict, bool]:
    """Cambia «arreglo.$» por el índice del primer elemento que encontró el filtro, como Mongo."""
    if not any(isinstance(c, dict) and any(isinstance(r, str) and ".$" in r for r in c) for c in update.values()):
        return update, False
    nuevo = {}
    for op, campos in update.items():
        nuevo[op] = {}
        for ruta, valor in campos.items():
            if isinstance(ruta, str) and ".$" in ruta:
                partes = ruta.split(".")
                if partes.count("$") != 1 or partes.index("$") == 0 or any(p.startswith("$") for p in partes if p != "$"):
                    raise NoSoportado(f"ruta {ruta!r}")
                arreglo = ".".join(partes[:partes.index("$")])
                lista = doc
                for p in arreglo.split("."):
                    lista = lista.get(p) if isinstance(lista, dict) else None
                if not isinstance(lista, list):
                    raise ErrorDeMongo("The positional operator did not find the match needed from the query.")
                condicion = _condicion_posicional(filtro, arreglo)
                indice = next((i for i, e in enumerate(lista) if _cumple_elemento(e, condicion)), None)
                if indice is None:
                    raise ErrorDeMongo("The positional operator did not find the match needed from the query.")
                partes[partes.index("$")] = str(indice)
                ruta = ".".join(partes)
            nuevo[op][ruta] = valor
    return nuevo, True


def _sin_efecto(arbol: dict, ops) -> bool:
    return all(_sin_efecto(v, ops) if isinstance(v, dict) else v[0] in ops for v in arbol.values())


def _agregar(op, actual, valor):
    if actual is _FALTA:
        actual = []
    elif not isinstance(actual, list):
        raise ErrorDeMongo(f"{op} sobre algo que no es arreglo")
    nuevos, slice_ = [valor], None
    if isinstance(valor, dict) and valor and all(k.startswith("$") for k in valor):
        if not isinstance(valor.get("$each"), list) or set(valor) - ({"$each", "$slice"} if op == "$push" else {"$each"}):
            raise NoSoportado(f"{op} con {sorted(valor)}")
        nuevos, slice_ = valor["$each"], valor.get("$slice")
    lista = list(actual)
    for v in nuevos:
        if op == "$push" or not any(_iguales(v, e) for e in lista):
            lista.append(copy.deepcopy(v))
    if slice_ is not None:
        if isinstance(slice_, bool) or not isinstance(slice_, int):
            raise ErrorDeMongo("$slice necesita un entero")
        lista = lista[:slice_] if slice_ >= 0 else lista[slice_:]
    return lista


def _quitar(elemento, condicion) -> bool:
    if isinstance(condicion, dict) and condicion and all(k.startswith("$") for k in condicion):
        if set(condicion) != {"$in"} or not isinstance(condicion["$in"], list):
            raise NoSoportado(f"$pull con {sorted(condicion)}")
        return any(_iguales(elemento, c) for c in condicion["$in"])
    if isinstance(condicion, dict):
        raise NoSoportado("$pull con un subdocumento (coincidencia parcial)")
    return _iguales(elemento, condicion)


# ── API ───────────────────────────────────────────────────────────────────────
def aplicar(doc: dict, update: dict, *, insertando: bool = False, filtro=None) -> dict:
    """El documento como queda tras el update (no modifica `doc`). Un _id no se puede cambiar.
    `filtro` solo hace falta para el posicional `$` (qué elemento encontró)."""
    indices = False
    if not insertando and isinstance(update, dict):
        update, indices = _resolver_posicional(doc, update, filtro)
    arbol = _arbol(update, insertando, indices)
    if "_id" in arbol:
        if not insertando and "_id" in doc:
            raise ErrorDeMongo("el _id no se puede cambiar")
    nuevo = copy.deepcopy(doc)
    _aplicar_en(nuevo, arbol)
    return nuevo


def _igualdades(filtro, salida: dict):
    """Los campos que Mongo 7 copia del filtro al documento de un upsert (medido): igualdades, $eq,
    un $in de un solo valor, las cláusulas de $and y un $or de una sola cláusula. $nor, un $or de varias
    y las demás condiciones no aportan nada. Un campo que sale dos veces es error en Mongo."""
    if not isinstance(filtro, dict):
        raise NoSoportado("filtro que no es dict")
    for campo, valor in filtro.items():
        if campo in ("$and", "$or", "$nor"):
            if not isinstance(valor, list) or not valor:
                raise NoSoportado(f"upsert con {campo} vacío")
            if campo == "$and" or (campo == "$or" and len(valor) == 1):
                for clausula in valor:
                    _igualdades(clausula, salida)
            continue
        if campo.startswith("$"):
            raise NoSoportado(f"upsert con {campo}")  # $expr es error en Mongo; lo demás no se usa
        if isinstance(valor, dict) and any(k.startswith("$") for k in valor):
            if set(valor) == {"$eq"}:
                valor = valor["$eq"]
            elif set(valor) == {"$in"} and isinstance(valor["$in"], list) and len(valor["$in"]) == 1:
                valor = valor["$in"][0]
            elif "$eq" in valor or "$in" in valor:
                raise NoSoportado(f"upsert con {sorted(valor)}")
            else:
                continue  # condiciones ($gt, $ne, $elemMatch…) no aportan campos al documento nuevo
        if not isinstance(valor, (type(None), bool, int, float, str, datetime, ObjectId, list)) and not (
                isinstance(valor, dict) and not any(k.startswith("$") for k in valor)):
            raise NoSoportado(f"upsert con un {type(valor).__name__} en el filtro")  # regex, Decimal128…
        if campo in salida:
            raise ErrorDeMongo(f"cannot infer query fields to set, path '{campo}' is matched twice")
        salida[campo] = valor


def documento_de_upsert(filtro: dict, update: dict, _id) -> dict:
    """El documento que crea un upsert: _id, los campos de igualdad del filtro y el update (con
    $setOnInsert). Lo que no se sabe armar igual que Mongo levanta NoSoportado."""
    base = {"_id": _id}
    igualdades = {}
    _igualdades(filtro or {}, igualdades)
    if "_id" in igualdades:
        base["_id"] = igualdades.pop("_id")
    # Primero los campos del filtro (orden lexicográfico, medido en Mongo 7) y después el update.
    con_filtro = aplicar(base, {"$set": igualdades}, insertando=True) if igualdades else base
    return aplicar(con_filtro, update, insertando=True)
