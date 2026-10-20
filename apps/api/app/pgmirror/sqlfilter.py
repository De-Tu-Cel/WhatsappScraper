"""Filtros de Mongo → SQL sobre la columna `doc` (jsonb en Extended JSON relajado).

Cubre lo que usa la app: igualdad (con la regla de Mongo "un arreglo coincide si
contiene el valor"), $eq, $ne, $in, $nin, $exists, $gt/$gte/$lt/$lte (números,
textos, fechas, ObjectId), $regex (+ opción i), $or/$and/$nor. Cualquier otra cosa
levanta Unsupported: la capa de enrutamiento entonces lee de Mongo, nunca adivina.
"""
import copy
import json
import re
from datetime import datetime, timezone

from bson import ObjectId
from bson.regex import Regex
from psycopg import sql

from app.pgmirror import codec


class Unsupported(Exception):
    pass


def _path(field: str):
    if not field or field.startswith("$"):
        raise Unsupported(f"campo {field!r}")
    return sql.SQL("(doc #> {})").format(sql.Literal(field.split(".")))


def _jsonb(value) -> sql.Composable:
    return sql.SQL("{}::jsonb").format(sql.Literal(json.dumps(codec.encode_value(value))))


def _eq(field: str, value) -> sql.Composable:
    if isinstance(value, (re.Pattern, Regex)):
        return _regex(field, value, "")
    if field == "_id" and isinstance(value, (ObjectId, str, int)) and not isinstance(value, bool):
        key, kind = codec.id_key(value)
        return sql.SQL("(id = {} AND id_type = {})").format(sql.Literal(key), sql.Literal(kind))
    p = _path(field)
    if value is None:
        return sql.SQL("({p} IS NULL OR {p} = 'null'::jsonb)").format(p=p)
    if isinstance(value, (dict, list)):
        return sql.SQL("COALESCE({p} = {v}, false)").format(p=p, v=_jsonb(value))
    as_array = sql.SQL("{}::jsonb").format(sql.Literal(json.dumps([codec.encode_value(value)])))
    return sql.SQL("COALESCE(({p} = {v} OR (jsonb_typeof({p}) = 'array' AND {p} @> {arr})), false)").format(
        p=p, v=_jsonb(value), arr=as_array)


def _cmp(field: str, op: str, value) -> sql.Composable:
    sym = sql.SQL({"$gt": ">", "$gte": ">=", "$lt": "<", "$lte": "<="}[op])
    p = _path(field)
    if isinstance(value, bool):
        raise Unsupported("comparación con booleano")
    if isinstance(value, (int, float)):
        return sql.SQL("COALESCE((jsonb_typeof({p}) = 'number' AND ({p})::numeric {s} {v}), false)").format(
            p=p, s=sym, v=sql.Literal(value))
    if isinstance(value, str):
        return sql.SQL("COALESCE((jsonb_typeof({p}) = 'string' AND ({p} #>> '{{}}') COLLATE \"C\" {s} {v}), false)").format(
            p=p, s=sym, v=sql.Literal(value))
    if isinstance(value, datetime):
        aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return sql.SQL("COALESCE((jsonb_typeof({p} -> '$date') = 'string' AND ({p} ->> '$date')::timestamptz {s} {v}), false)").format(
            p=p, s=sym, v=sql.Literal(aware))
    if isinstance(value, ObjectId):
        return sql.SQL("COALESCE((({p} ->> '$oid') {s} {v}), false)").format(p=p, s=sym, v=sql.Literal(str(value)))
    raise Unsupported(f"comparación con {type(value).__name__}")


def _regex(field: str, pattern, options: str) -> sql.Composable:
    if isinstance(pattern, re.Pattern):
        options += "i" if pattern.flags & re.IGNORECASE else ""
        pattern = pattern.pattern
    elif isinstance(pattern, Regex):
        options += pattern.flags if isinstance(pattern.flags, str) else ""
        pattern = pattern.pattern
    if set(options) - {"i"}:
        raise Unsupported(f"opciones de regex {options!r}")
    op = sql.SQL("~*" if "i" in options else "~")
    p = _path(field)
    return sql.SQL("COALESCE((jsonb_typeof({p}) = 'string' AND ({p} #>> '{{}}') {op} {v}), false)").format(
        p=p, op=op, v=sql.Literal(pattern))


def _field(field: str, spec) -> sql.Composable:
    if not (isinstance(spec, dict) and spec and all(k.startswith("$") for k in spec)):
        return _eq(field, spec)
    parts = []
    for op, value in spec.items():
        if op == "$eq":
            parts.append(_eq(field, value))
        elif op == "$ne":
            parts.append(sql.SQL("NOT {}").format(_eq(field, value)))
        elif op == "$in":
            if not isinstance(value, (list, tuple)):
                raise Unsupported("$in sin lista")
            parts.append(sql.SQL("({})").format(sql.SQL(" OR ").join(_eq(field, v) for v in value)) if value else sql.SQL("false"))
        elif op == "$nin":
            if not isinstance(value, (list, tuple)):
                raise Unsupported("$nin sin lista")
            parts.append(sql.SQL("NOT ({})").format(sql.SQL(" OR ").join(_eq(field, v) for v in value)) if value else sql.SQL("true"))
        elif op == "$exists":
            parts.append(sql.SQL("({} IS {} NULL)").format(_path(field), sql.SQL("NOT" if value else "")))
        elif op in ("$gt", "$gte", "$lt", "$lte"):
            parts.append(_cmp(field, op, value))
        elif op == "$regex":
            parts.append(_regex(field, value, spec.get("$options", "")))
        elif op == "$options":
            continue
        else:
            raise Unsupported(op)
    return sql.SQL("({})").format(sql.SQL(" AND ").join(parts))


def where(filter_: dict | None) -> sql.Composable:
    """WHERE equivalente al filtro de Mongo (sin la palabra WHERE)."""
    if not filter_:
        return sql.SQL("true")
    if not isinstance(filter_, dict):
        raise Unsupported("filtro no es dict")
    parts = []
    for key, value in filter_.items():
        if key in ("$or", "$and", "$nor"):
            if not isinstance(value, (list, tuple)) or not value:
                raise Unsupported(f"{key} vacío")
            joined = sql.SQL(" OR " if key in ("$or", "$nor") else " AND ").join(
                sql.SQL("({})").format(where(sub)) for sub in value)
            parts.append(sql.SQL("NOT ({})" if key == "$nor" else "({})").format(joined))
        elif key == "$comment":
            continue
        elif key.startswith("$"):
            raise Unsupported(key)
        else:
            parts.append(_field(key, value))
    return sql.SQL(" AND ").join(parts) if parts else sql.SQL("true")


def order_by(sort) -> sql.Composable | None:
    """sort de pymongo ([(campo, 1|-1)] o dict) → ORDER BY. Faltante/null va primero
    en ascendente, como en Mongo. Con tipos mezclados en un mismo campo el orden
    puede diferir de Mongo (el modo shadow lo detecta)."""
    if not sort:
        return None
    items = sort.items() if isinstance(sort, dict) else sort
    parts = []
    for field, direction in items:
        if not isinstance(direction, int) or direction not in (1, -1):
            raise Unsupported(f"orden {direction!r}")
        parts.append(sql.SQL("{} {}").format(
            _path(field), sql.SQL("ASC NULLS FIRST" if direction == 1 else "DESC NULLS LAST")))
    return sql.SQL(", ").join(parts)


def apply_projection(doc: dict, projection) -> dict:
    """Proyección simple de Mongo (incluir/excluir campos, con rutas punteadas)."""
    if not projection:
        return doc
    if isinstance(projection, (list, tuple)):
        projection = {f: 1 for f in projection}
    if any(isinstance(v, dict) for v in projection.values()):
        raise Unsupported("proyección con operadores")
    include_id = projection.get("_id", 1)
    fields = {k: v for k, v in projection.items() if k != "_id"}
    inclusive = any(bool(v) for v in fields.values())
    if inclusive:
        out = {}
        for path in (k for k, v in fields.items() if v):
            src, dst, parts = doc, out, path.split(".")
            for i, part in enumerate(parts):
                if not isinstance(src, dict) or part not in src:
                    break
                if i == len(parts) - 1:
                    dst[part] = src[part]
                else:
                    src = src[part]
                    dst = dst.setdefault(part, {})
        if include_id and "_id" in doc:
            out = {"_id": doc["_id"], **out}
        return out
    out = copy.deepcopy(doc)  # sin esto, quitar un campo anidado tocaba el documento original
    for path in fields:
        parts, target = path.split("."), out
        for part in parts[:-1]:
            target = target.get(part) if isinstance(target, dict) else None
        if isinstance(target, dict):
            target.pop(parts[-1], None)
    if not include_id:
        out.pop("_id", None)
    return out
