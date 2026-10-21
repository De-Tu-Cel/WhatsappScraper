"""aggregate() de Mongo sobre Postgres, para lo que la app usa (inventario del 2026-10-21: 28 pipelines).

El $match y el $sort del principio se traducen a SQL (sqlfilter, ya medido contra Mongo 7): Postgres
filtra y ordena. El resto del pipeline corre aquí en Python con la semántica de Mongo: $group con
$sum/$first/$last/$max/$min/$addToSet/$push, $project, $match sobre campos calculados, $sort, $skip,
$limit y $count; expresiones $cond, $ifNull, $eq, $ne, $and, $or, $size, $dateToString (UTC) y
$$REMOVE. Lo demás levanta sqlfilter.Unsupported y la consulta se resuelve en Mongo: nunca adivina.
tests/test_pgmirror_agregar.py lo compara contra Mongo 7 real.
"""
import copy
from datetime import datetime, timezone
from decimal import Decimal

from bson import ObjectId

from app.pgmirror import codec, sqlfilter
from app.pgmirror.sqlfilter import Unsupported

_FALTA = object()


# ── valores y comparación como BSON ────────────────────────────────────────────
def _rango(v) -> int:
    if v is _FALTA or v is None:
        return 1
    if isinstance(v, bool):
        return 8
    if isinstance(v, (int, float)):
        return 2
    if isinstance(v, str):
        return 3
    if isinstance(v, dict):
        return 4
    if isinstance(v, list):
        return 5
    if isinstance(v, bytes):
        return 6
    if isinstance(v, ObjectId):
        return 7
    if isinstance(v, datetime):
        return 9
    raise Unsupported(f"valor {type(v).__name__} en una agregación")


def _ms(dt: datetime) -> int:
    from bson.datetime_ms import _datetime_to_millis
    return _datetime_to_millis(dt)


def _llave_orden(v):
    """Orden de BSON entre valores sueltos (para $sort, $max, $min)."""
    r = _rango(v)
    if r == 1:
        return (1, 0)
    if r == 2:
        return (2, Decimal(repr(v)) if isinstance(v, float) else Decimal(v))
    if r == 3:
        return (3, v.encode("utf-8"))  # binario, como COLLATE "C"
    if r == 7:
        return (7, str(v))
    if r == 8:
        return (8, int(v))
    if r == 9:
        return (9, _ms(v))
    raise Unsupported("ordenar o comparar subdocumentos/arreglos en una agregación")


def _marca(v):
    """Igualdad de BSON (1 == 1.0; subdocumentos con el mismo orden de llaves)."""
    if v is _FALTA:
        v = None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return ("n", Decimal(repr(v)) if isinstance(v, float) else Decimal(v))
    return ("v", codec.encode_doc({"v": v}))


def _iguales(a, b) -> bool:
    return _marca(a) == _marca(b)


# ── expresiones ────────────────────────────────────────────────────────────────
def _ruta(doc, ruta: str):
    """"$a.b": como Mongo, recorre subdocumentos y, en un arreglo, junta lo de cada elemento-documento."""
    actual = doc
    for parte in ruta.split("."):
        if isinstance(actual, dict):
            actual = actual.get(parte, _FALTA)
        elif isinstance(actual, list):
            actual = [e.get(parte) for e in actual if isinstance(e, dict) and parte in e]
        else:
            return _FALTA
        if actual is _FALTA:
            return _FALTA
    return actual


def _verdadero(v) -> bool:
    """Verdad de Mongo: falsos solo false, null, faltante y el cero."""
    if v is _FALTA or v is None or v is False:
        return False
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return v != 0
    return True


_FORMATOS = {"%Y": lambda d: f"{d.year:04d}", "%m": lambda d: f"{d.month:02d}", "%d": lambda d: f"{d.day:02d}",
             "%H": lambda d: f"{d.hour:02d}", "%M": lambda d: f"{d.minute:02d}", "%S": lambda d: f"{d.second:02d}",
             "%L": lambda d: f"{d.microsecond // 1000:03d}", "%%": lambda d: "%"}


def _fecha_a_texto(formato: str, fecha: datetime) -> str:
    if fecha.tzinfo is not None:
        fecha = fecha.astimezone(timezone.utc)
    fuera, i = [], 0
    while i < len(formato):
        if formato[i] == "%":
            clave = formato[i:i + 2]
            if clave not in _FORMATOS:
                raise Unsupported(f"$dateToString con {clave}")
            fuera.append(_FORMATOS[clave](fecha))
            i += 2
        else:
            fuera.append(formato[i])
            i += 1
    return "".join(fuera)


def evaluar(expr, doc):
    """Valor de una expresión de agregación sobre `doc` (_FALTA si no existe)."""
    if isinstance(expr, str):
        if expr == "$$REMOVE":
            return _FALTA
        if expr.startswith("$$"):
            raise Unsupported(f"variable {expr}")
        if expr.startswith("$"):
            return _ruta(doc, expr[1:])
        return expr
    if isinstance(expr, list):
        return [evaluar(e, doc) for e in expr]
    if not isinstance(expr, dict):
        return expr
    if len(expr) == 1 and next(iter(expr)).startswith("$"):
        op, arg = next(iter(expr.items()))
        args = arg if isinstance(arg, list) else [arg]
        if op == "$cond":
            if isinstance(arg, dict):
                args = [arg.get("if"), arg.get("then"), arg.get("else")]
            si, entonces, sino = args
            return evaluar(entonces if _verdadero(evaluar(si, doc)) else sino, doc)
        if op == "$ifNull":
            for a in args[:-1]:
                v = evaluar(a, doc)
                if v is not _FALTA and v is not None:
                    return v
            return evaluar(args[-1], doc)
        if op in ("$eq", "$ne"):
            a, b = (evaluar(x, doc) for x in args)
            a, b = (None if x is _FALTA else x for x in (a, b))
            return _iguales(a, b) if op == "$eq" else not _iguales(a, b)
        if op in ("$and", "$or"):
            valores = [_verdadero(evaluar(a, doc)) for a in args]
            return all(valores) if op == "$and" else any(valores)
        if op == "$size":
            v = evaluar(args[0], doc)
            if not isinstance(v, list):
                raise Unsupported("$size de algo que no es arreglo")  # en Mongo es error
            return len(v)
        if op == "$dateToString":
            if not isinstance(arg, dict) or set(arg) - {"format", "date"}:
                raise Unsupported("$dateToString con opciones")
            fecha = evaluar(arg["date"], doc)
            if fecha is _FALTA or fecha is None:
                return None
            if not isinstance(fecha, datetime):
                raise Unsupported("$dateToString de algo que no es fecha")
            return _fecha_a_texto(arg.get("format", "%Y-%m-%dT%H:%M:%S.%LZ"), fecha)
        if op == "$toString":
            # contacts.company_id mezcla texto y ObjectId: se normaliza antes de agrupar (routes.py).
            v = evaluar(args[0], doc)
            if v is _FALTA or v is None:
                return None
            if isinstance(v, (str, ObjectId)) or isinstance(v, int) and not isinstance(v, bool):
                return str(v)
            raise Unsupported(f"$toString de {type(v).__name__}")
        if op == "$literal":
            return arg
        raise Unsupported(f"expresión {op}")
    # Documento de expresiones: los campos que dan «faltante» no aparecen.
    fuera = {}
    for k, v in expr.items():
        valor = evaluar(v, doc)
        if valor is not _FALTA:
            fuera[k] = valor
    return fuera


# ── etapas ─────────────────────────────────────────────────────────────────────
def _agrupar(docs, etapa: dict) -> list:
    if "_id" not in etapa:
        raise Unsupported("$group sin _id")
    grupos, orden = {}, []
    acumuladores = {k: v for k, v in etapa.items() if k != "_id"}
    for nombre, acc in acumuladores.items():
        if not (isinstance(acc, dict) and len(acc) == 1 and next(iter(acc)) in
                ("$sum", "$first", "$last", "$max", "$min", "$addToSet", "$push")):
            raise Unsupported(f"acumulador {acc!r}")
    for doc in docs:
        llave = evaluar(etapa["_id"], doc)
        llave = None if llave is _FALTA else llave
        marca = _marca(llave)
        if marca not in grupos:
            grupos[marca] = {"_id": llave, "_estado": {}}
            orden.append(marca)
        estado = grupos[marca]["_estado"]
        for nombre, acc in acumuladores.items():
            op, expr = next(iter(acc.items()))
            v = evaluar(expr, doc)
            if op == "$sum":
                actual = estado.get(nombre, 0)
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    actual = actual + v
                estado[nombre] = actual
            elif op == "$first":
                estado.setdefault(nombre, None if v is _FALTA else v)
            elif op == "$last":
                estado[nombre] = None if v is _FALTA else v
            elif op in ("$max", "$min"):
                if v is _FALTA or v is None:
                    estado.setdefault(nombre, None)
                    continue
                actual = estado.get(nombre)
                if actual is None or (_llave_orden(v) > _llave_orden(actual) if op == "$max" else _llave_orden(v) < _llave_orden(actual)):
                    estado[nombre] = v
            elif op == "$addToSet":
                lista, vistos = estado.setdefault(nombre, ([], set()))
                if v is not _FALTA:
                    m = _marca(v)
                    if m not in vistos:
                        vistos.add(m)
                        lista.append(v)
            elif op == "$push":
                if v is not _FALTA:
                    estado.setdefault(nombre, []).append(v)
                else:
                    estado.setdefault(nombre, [])
    fuera = []
    for marca in orden:
        g = grupos[marca]
        doc = {"_id": g["_id"]}
        for nombre, acc in acumuladores.items():
            op = next(iter(acc))
            valor = g["_estado"].get(nombre)
            if op == "$addToSet":
                valor = valor[0] if valor else []
            elif op == "$push":
                valor = valor or []
            elif op == "$sum" and valor is None:
                valor = 0
            doc[nombre] = valor
        fuera.append(doc)
    return fuera


def _proyectar(docs, etapa: dict) -> list:
    incluir_id = etapa.get("_id", 1) not in (0, False)
    campos = {k: v for k, v in etapa.items() if k != "_id"}
    excluir = campos and all(v in (0, False) for v in campos.values())
    fuera = []
    for doc in docs:
        if excluir:
            nuevo = {k: v for k, v in doc.items() if k not in campos and (incluir_id or k != "_id")}
        else:
            # Como Mongo: primero los incluidos con 1, en el orden del documento; luego los calculados,
            # en el orden del $project.
            nuevo = {"_id": doc["_id"]} if incluir_id and "_id" in doc else {}
            for k, v in campos.items():
                if "." in k:
                    raise Unsupported("$project de rutas punteadas")
                if v in (0, False):
                    raise Unsupported("$project que mezcla incluir y excluir")
            for k in doc:
                if k != "_id" and campos.get(k, 0) in (1, True) and not isinstance(campos.get(k), (dict, str, list)):
                    nuevo[k] = doc[k]
            for k, v in campos.items():
                if not (v in (1, True) and not isinstance(v, (dict, str, list))):
                    valor = evaluar(v, doc)
                    if valor is not _FALTA:
                        nuevo[k] = valor
        fuera.append(nuevo)
    return fuera


def _cumple(doc, filtro: dict) -> bool:
    """$match después de un $group/$project: campos de primer nivel con valores sueltos."""
    for campo, cond in filtro.items():
        if campo.startswith("$") or "." in campo:
            raise Unsupported(f"$match calculado con {campo}")
        v = doc.get(campo, _FALTA)
        conds = cond.items() if isinstance(cond, dict) and cond and all(k.startswith("$") for k in cond) else [("$eq", cond)]
        for op, ref in conds:
            if isinstance(v, list) or isinstance(ref, (dict, list)) and op not in ("$in", "$nin"):
                raise Unsupported("$match calculado sobre arreglos o subdocumentos")
            if op in ("$eq", "$ne"):
                igual = _iguales(v, ref) if not (v is _FALTA and ref is not None) else False
                if (op == "$eq") != igual:
                    return False
            elif op in ("$in", "$nin"):
                dentro = any(_iguales(v, r) if not (v is _FALTA and r is not None) else False for r in ref)
                if (op == "$in") != dentro:
                    return False
            elif op in ("$gt", "$gte", "$lt", "$lte"):
                if v is _FALTA or v is None or _rango(v) != _rango(ref):
                    return False
                a, b = _llave_orden(v), _llave_orden(ref)
                if not {"$gt": a > b, "$gte": a >= b, "$lt": a < b, "$lte": a <= b}[op]:
                    return False
            elif op == "$exists":
                if (v is not _FALTA) != bool(ref):
                    return False
            else:
                raise Unsupported(f"$match calculado con {op}")
    return True


def _ordenar(docs, etapa: dict) -> list:
    items = list(etapa.items())
    for campo, direccion in items:
        if direccion not in (1, -1) or isinstance(direccion, bool):
            raise Unsupported("$sort raro")
    resultado = list(docs)
    # Orden estable de derecha a izquierda; cada llave con su dirección.
    for campo, direccion in reversed(items):
        resultado.sort(key=lambda d: _llave_orden(_ruta(d, campo)), reverse=direccion == -1)
    return resultado


def ejecutar(store, coleccion: str, pipeline: list) -> list:
    """Corre el pipeline sobre la tabla espejo. Unsupported si algo no se sabe hacer igual que Mongo."""
    if not isinstance(pipeline, list) or not pipeline:
        raise Unsupported("pipeline vacío")
    etapas = [dict(e) for e in pipeline]
    for e in etapas:
        if not isinstance(e, dict) or len(e) != 1:
            raise Unsupported("etapa rara")
    # $match + $sort del principio: en SQL.
    filtro, orden, i = {}, None, 0
    while i < len(etapas) and next(iter(etapas[i])) == "$match":
        filtro = {"$and": [filtro, etapas[i]["$match"]]} if filtro else etapas[i]["$match"]
        i += 1
    if i < len(etapas) and next(iter(etapas[i])) == "$sort":
        orden = list(etapas[i]["$sort"].items())
        i += 1
    where = sqlfilter.where(filtro)
    plan = sqlfilter.sort_plan(orden) if orden else None
    docs = store.query_docs(coleccion, where, plan=plan)
    for etapa in etapas[i:]:
        op, arg = next(iter(etapa.items()))
        if op == "$group":
            docs = _agrupar(docs, arg)
        elif op == "$project":
            docs = _proyectar(docs, arg)
        elif op == "$match":
            docs = [d for d in docs if _cumple(d, arg)]
        elif op == "$sort":
            docs = _ordenar(docs, arg)
        elif op == "$skip":
            docs = docs[int(arg):]
        elif op == "$limit":
            docs = docs[:int(arg)]
        elif op == "$count":
            docs = [{arg: len(docs)}] if docs else []
        else:
            raise Unsupported(f"etapa {op}")
    return copy.deepcopy(docs)
