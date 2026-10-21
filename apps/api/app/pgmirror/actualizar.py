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


def _partes(ruta) -> list[str]:
    if not isinstance(ruta, str) or not ruta:
        raise NoSoportado(f"ruta {ruta!r}")
    partes = ruta.split(".")
    if any(not p or p.startswith("$") or p.isdigit() for p in partes):  # posicionales e índices: no se usan
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
def _arbol(update: dict, insertando: bool) -> dict:
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
            partes = _partes(ruta)
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
def aplicar(doc: dict, update: dict, *, insertando: bool = False) -> dict:
    """El documento como queda tras el update (no modifica `doc`). Un _id no se puede cambiar."""
    arbol = _arbol(update, insertando)
    if "_id" in arbol:
        if not insertando and "_id" in doc:
            raise ErrorDeMongo("el _id no se puede cambiar")
    nuevo = copy.deepcopy(doc)
    _aplicar_en(nuevo, arbol)
    return nuevo


def documento_de_upsert(filtro: dict, update: dict, _id) -> dict:
    """El documento que crea un upsert: _id, los campos de igualdad del filtro y el update (con
    $setOnInsert). Solo filtros de igualdad simple; lo demás no se adivina."""
    base = {"_id": _id}
    igualdades = {}
    for campo, valor in (filtro or {}).items():
        if campo.startswith("$"):
            raise NoSoportado(f"upsert con {campo}")
        if isinstance(valor, dict) and any(k.startswith("$") for k in valor):
            if set(valor) == {"$eq"}:
                valor = valor["$eq"]
            else:
                continue  # condiciones ($gt, $in…) no aportan campos al documento nuevo
        if campo == "_id":
            base["_id"] = valor
            continue
        igualdades[campo] = valor
    # Primero los campos del filtro (orden lexicográfico, medido en Mongo 7) y después el update.
    con_filtro = aplicar(base, {"$set": igualdades}, insertando=True) if igualdades else base
    return aplicar(con_filtro, update, insertando=True)
