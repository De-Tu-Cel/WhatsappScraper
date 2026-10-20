"""Filtros, orden y proyecciones de Mongo → SQL sobre `doc` (jsonb en Extended JSON relajado).

La semántica se midió contra Mongo 7 real y se vuelve a comparar en cada corrida de CI
(tests/test_pgmirror_vs_mongo.py):
- Una ruta a.b.c recorre objetos y, en cada nivel, los elementos-objeto de un arreglo.
  Un elemento que no es objeto (número, arreglo anidado) no aporta nada.
- Igualdad: el valor final es igual, o es un arreglo que lo contiene.
- null: coincide si el valor falta (o un nivel intermedio es escalar o null), si es
  null o si es un arreglo que contiene null. Un arreglo intermedio solo cuenta por sus
  elementos-objeto: {"a": []} y {"a": [1, 2]} NO coinciden con {"a.b": null}.
- $gt/$lt…: el valor final o cualquier elemento suyo, y solo del mismo tipo.
- Orden: un arreglo ordena por su menor elemento (asc) o su mayor (desc), el arreglo
  vacío va antes que null, y sin sort se respeta el orden de inserción (columna seq,
  el equivalente del orden natural de Mongo).
- Proyección a.b: entra en cada elemento-objeto (y arreglo anidado) de un arreglo.
Cualquier otra cosa (o una regex cuya sintaxis signifique algo distinto en PCRE y en
Postgres) levanta Unsupported y la capa lee de Mongo: nunca adivina.
"""
import json
import math
import re
from datetime import datetime
from decimal import Decimal
from typing import NamedTuple

from bson import ObjectId
from bson.regex import Regex
from psycopg import sql

from app.pgmirror import codec


class Unsupported(Exception):
    pass


def _parts(field) -> list[str]:
    if not isinstance(field, str) or not field:
        raise Unsupported(f"campo {field!r}")
    parts = field.split(".")
    # "a.0" en Mongo es índice de arreglo O llave "0": ambiguo, se deja a Mongo.
    if any(not p or p.startswith("$") or p.isdigit() for p in parts):
        raise Unsupported(f"campo {field!r}")
    return parts


def _check_value(value):
    if isinstance(value, str) and "\x00" in value:
        raise Unsupported("texto con NUL")
    if isinstance(value, float) and not math.isfinite(value):
        raise Unsupported("NaN/Infinity")
    if isinstance(value, dict):
        for v in value.values():
            _check_value(v)
    elif isinstance(value, list):
        for v in value:
            _check_value(v)


def _jsonb(value) -> sql.Composable:
    return sql.SQL("{}::jsonb").format(sql.Literal(json.dumps(codec.encode_value(value))))


def _has_subdoc(value) -> bool:
    if isinstance(value, dict):
        return True
    return isinstance(value, list) and any(_has_subdoc(v) for v in value)


# Llaves con las que Extended JSON guarda valores que NO son subdocumentos
# (ObjectId, fechas, decimales, binarios…; $nulstr es un texto con NUL, ver codec).
_EJSON_KEYS = sql.SQL(
    "array['$oid', '$date', '$numberDecimal', '$numberDouble', '$numberLong', '$binary', '$regularExpression', "
    "'$timestamp', '$minKey', '$maxKey', '$symbol', '$code', '$dbPointer', '$undefined', '$uuid', '$nulstr']")


def _is_doc(x) -> sql.Composable:
    """¿Es un subdocumento de verdad? (un ObjectId guardado como {"$oid": …} no lo es). Nunca NULL."""
    return sql.SQL("COALESCE(jsonb_typeof({x}) = 'object' AND NOT ({x} ?| {keys}), false)").format(x=x, keys=_EJSON_KEYS)


def _walk(base, parts, terminal, missing: bool, depth: int = 0) -> sql.Composable:
    """Condición (nunca NULL) sobre el objeto `base` siguiendo la ruta como Mongo.
    `terminal(x)` evalúa el valor final; `missing` es el resultado cuando un nivel
    intermedio falta o es escalar/null."""
    value = sql.SQL("({} -> {})").format(base, sql.Literal(parts[0]))
    if len(parts) == 1:
        return sql.SQL("COALESCE({}, false)").format(terminal(value))
    elem = sql.Identifier(f"_e{depth}")
    return sql.SQL(
        "(CASE WHEN {v_doc} THEN {in_obj} "
        "WHEN jsonb_typeof({v}) = 'array' THEN EXISTS (SELECT 1 FROM jsonb_array_elements({v}) AS {t}({e}) "
        "WHERE {e_doc} AND {in_elem}) "
        "ELSE {missing} END)").format(
            v=value, v_doc=_is_doc(value), t=sql.Identifier(f"_t{depth}"), e=elem, e_doc=_is_doc(elem),
            in_obj=_walk(value, parts[1:], terminal, missing, depth + 1),
            in_elem=_walk(elem, parts[1:], terminal, missing, depth + 1),
            missing=sql.SQL("true" if missing else "false"))


def _or_any_element(scalar):
    """El valor final cumple, o es un arreglo con algún elemento que cumple."""
    def terminal(x):
        return sql.SQL(
            "(COALESCE({own}, false) OR (jsonb_typeof({x}) = 'array' AND EXISTS ("
            "SELECT 1 FROM jsonb_array_elements({x}) AS _a(_v) WHERE COALESCE({elem}, false))))").format(
                own=scalar(x), x=x, elem=scalar(sql.Identifier("_v")))
    return terminal


def _ts(x) -> sql.Composable:
    """Fecha Extended JSON → timestamptz ({"$date": "…Z"} o, fuera de 1970-9999, {"$date": {"$numberLong": ms}})."""
    return sql.SQL(
        "(CASE WHEN jsonb_typeof({x} -> '$date') = 'string' THEN ({x} ->> '$date')::timestamptz "
        "ELSE to_timestamp(({x} -> '$date' ->> '$numberLong')::numeric / 1000) END)").format(x=x)


# ── Condiciones ────────────────────────────────────────────────────────────────
def _eq(field: str, value) -> sql.Composable:
    if isinstance(value, (re.Pattern, Regex)):
        return _regex(field, value, "")
    if field == "_id" and isinstance(value, (ObjectId, str, int)) and not isinstance(value, bool):
        _check_value(value)
        key, kind = codec.id_key(value)
        return sql.SQL("(id = {} AND id_type = {})").format(sql.Literal(key), sql.Literal(kind))
    _check_value(value)
    if _has_subdoc(value):
        # Mongo compara subdocumentos con el orden de sus llaves; jsonb no lo distingue.
        raise Unsupported("igualdad con subdocumento")
    if value is None:
        def terminal(x):
            return sql.SQL("({x} IS NULL OR {x} = 'null'::jsonb OR (jsonb_typeof({x}) = 'array' AND {x} @> '[null]'::jsonb))").format(x=x)
    elif isinstance(value, (dict, list)):
        target = _jsonb(value)
        terminal = _or_any_element(lambda x: sql.SQL("{} = {}").format(x, target))
    else:
        target = _jsonb(value)
        as_array = sql.SQL("{}::jsonb").format(sql.Literal(json.dumps([codec.encode_value(value)])))

        def terminal(x):
            return sql.SQL("({x} = {v} OR (jsonb_typeof({x}) = 'array' AND {x} @> {arr}))").format(x=x, v=target, arr=as_array)
    return _walk(sql.SQL("doc"), _parts(field), terminal, missing=value is None)


def _cmp(field: str, op: str, value) -> sql.Composable:
    sym = sql.SQL({"$gt": ">", "$gte": ">=", "$lt": "<", "$lte": "<="}[op])
    _check_value(value)
    if isinstance(value, bool) or value is None:
        raise Unsupported(f"comparación con {value!r}")
    if isinstance(value, (int, float)):
        literal = sql.Literal(Decimal(repr(value)) if isinstance(value, float) else int(value))

        def scalar(x):
            return sql.SQL("(CASE WHEN jsonb_typeof({x}) = 'number' THEN ({x})::numeric {s} {v} END)").format(x=x, s=sym, v=literal)
    elif isinstance(value, str):
        def scalar(x):
            return sql.SQL("(CASE WHEN jsonb_typeof({x}) = 'string' THEN ({x} #>> '{{}}') COLLATE \"C\" {s} {v} END)").format(
                x=x, s=sym, v=sql.Literal(value))
    elif isinstance(value, datetime):
        iso = codec.encode_value(value).get("$date")  # misma precisión (ms) que guarda Mongo
        if not isinstance(iso, str):
            raise Unsupported("fecha fuera de 1970-9999")

        def scalar(x):
            return sql.SQL("(CASE WHEN jsonb_typeof({x}) = 'object' AND {x} ? '$date' THEN {ts} {s} {v}::timestamptz END)").format(
                x=x, ts=_ts(x), s=sym, v=sql.Literal(iso))
    elif isinstance(value, ObjectId):
        def scalar(x):
            return sql.SQL("(CASE WHEN jsonb_typeof({x}) = 'object' AND {x} ? '$oid' THEN ({x} ->> '$oid') COLLATE \"C\" {s} {v} END)").format(
                x=x, s=sym, v=sql.Literal(str(value)))
    else:
        raise Unsupported(f"comparación con {type(value).__name__}")
    return _walk(sql.SQL("doc"), _parts(field), _or_any_element(scalar), missing=False)


# Escapes \letra que significan lo mismo en PCRE (Mongo) y en las regex de Postgres.
_SAFE_ESCAPES = set("dDsSnrt")
_RE_FLAG_LETTERS = {re.IGNORECASE: "i", re.MULTILINE: "m", re.DOTALL: "s", re.VERBOSE: "x"}


def _check_regex(pattern: str):
    if "\x00" in pattern:
        raise Unsupported("regex con NUL")
    i = 0
    while i < len(pattern):
        ch = pattern[i]
        if ch == "\\":
            if i + 1 >= len(pattern):
                raise Unsupported("regex termina en \\")
            nxt = pattern[i + 1]
            # \b es "límite de palabra" en PCRE y "retroceso" en Postgres; \w cambia con acentos; \1…
            if nxt.isalnum() and nxt not in _SAFE_ESCAPES:
                raise Unsupported(f"regex \\{nxt}")
            i += 2
            continue
        if pattern.startswith("(?", i) and not pattern.startswith("(?:", i):
            raise Unsupported("regex (?…)")
        # [^…] sí coincide con salto de línea en PCRE pero no con la opción (?p) que usamos para el punto.
        if pattern.startswith("[^", i) or pattern.startswith("[:", i) or pattern.startswith("{,", i):
            raise Unsupported(f"regex {pattern[i:i + 2]}")
        if ch in "*+?}" and pattern.startswith("+", i + 1):
            raise Unsupported("regex posesiva")
        i += 1


def _regex(field: str, pattern, options: str) -> sql.Composable:
    options = options or ""
    if isinstance(pattern, (re.Pattern, Regex)):
        flags = pattern.flags
        if isinstance(flags, int):
            options += "".join(letter for flag, letter in _RE_FLAG_LETTERS.items() if flags & flag)
        else:
            options += flags or ""
        pattern = pattern.pattern
    if not isinstance(pattern, str) or not isinstance(options, str):
        raise Unsupported("regex no es texto")
    if set(options) - {"i", "u"}:
        raise Unsupported(f"opciones de regex {options!r}")
    _check_regex(pattern)
    # (?p): el punto no cruza saltos de línea (como PCRE) y ^/$ siguen siendo inicio/fin del texto.
    target = sql.Literal("(?p)" + pattern)
    if "i" in options:
        # Mayúsculas/minúsculas con acentos (Ñ/ñ, É/é) como Mongo, sin depender del locale de la base.
        def scalar(x):
            return sql.SQL("(CASE WHEN jsonb_typeof({x}) = 'string' THEN (({x} #>> '{{}}') COLLATE \"und-x-icu\") ~* {p} END)").format(
                x=x, p=target)
    else:
        def scalar(x):
            return sql.SQL("(CASE WHEN jsonb_typeof({x}) = 'string' THEN ({x} #>> '{{}}') ~ {p} END)").format(x=x, p=target)
    return _walk(sql.SQL("doc"), _parts(field), _or_any_element(scalar), missing=False)


def _exists(field: str) -> sql.Composable:
    return _walk(sql.SQL("doc"), _parts(field), lambda x: sql.SQL("({} IS NOT NULL)").format(x), missing=False)


def _field(field: str, spec) -> sql.Composable:
    if not (isinstance(spec, dict) and spec and all(k.startswith("$") for k in spec)):
        return _eq(field, spec)
    parts = []
    for op, value in spec.items():
        if op == "$eq":
            parts.append(_eq(field, value))
        elif op == "$ne":
            parts.append(sql.SQL("NOT {}").format(_eq(field, value)))
        elif op in ("$in", "$nin"):
            if not isinstance(value, (list, tuple)):
                raise Unsupported(f"{op} sin lista")
            any_of = sql.SQL("({})").format(sql.SQL(" OR ").join(_eq(field, v) for v in value)) if value else sql.SQL("false")
            parts.append(any_of if op == "$in" else sql.SQL("NOT {}").format(any_of))
        elif op == "$exists":
            parts.append(_exists(field) if value else sql.SQL("NOT {}").format(_exists(field)))
        elif op in ("$gt", "$gte", "$lt", "$lte"):
            parts.append(_cmp(field, op, value))
        elif op == "$regex":
            parts.append(_regex(field, value, spec.get("$options", "")))
        elif op == "$options":
            if "$regex" not in spec:
                raise Unsupported("$options sin $regex")
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


# ── Orden ──────────────────────────────────────────────────────────────────────
class SortPlan(NamedTuple):
    lateral: sql.Composable | None  # columnas _s0, _s1… calculadas una vez por fila
    order: sql.Composable           # cuerpo del ORDER BY


def sort_items(sort) -> list[tuple[str, int]]:
    if not sort:
        return []
    items = list(sort.items()) if isinstance(sort, dict) else list(sort)
    for item in items:
        if not (isinstance(item, (list, tuple)) and len(item) == 2):
            raise Unsupported(f"orden {item!r}")
        field, direction = item
        if isinstance(direction, bool) or direction not in (1, -1):
            raise Unsupported(f"orden {direction!r}")
        _parts(field)
    return [(f, d) for f, d in items]


def _components(k) -> list[sql.Composable]:
    """Llaves de orden de un valor jsonb en el orden de tipos de BSON:
    (vacío) < null < números < textos < objetos < arreglos < binarios < ObjectId < bool < fechas."""
    typ = sql.SQL("jsonb_typeof({})").format(k)
    is_obj = sql.SQL("jsonb_typeof({}) = 'object'").format(k)
    rank = sql.SQL(
        "(CASE WHEN {k} IS NULL OR {t} = 'null' THEN 1 WHEN {t} = 'number' THEN 2 WHEN {t} = 'string' THEN 3 "
        "WHEN {t} = 'boolean' THEN 8 WHEN {t} = 'array' THEN 5 WHEN {k} ? '$emptyArray' THEN 0 "
        "WHEN {k} ? '$oid' THEN 7 WHEN {k} ? '$date' THEN 9 "
        "WHEN {k} ?| array['$numberDecimal', '$numberDouble', '$numberLong'] THEN 2 "
        "WHEN {k} ? '$binary' THEN 6 WHEN {k} ? '$timestamp' THEN 10 WHEN {k} ? '$regularExpression' THEN 11 "
        "ELSE 4 END)").format(k=k, t=typ)
    number = sql.SQL(
        "(CASE WHEN {t} = 'number' THEN ({k})::numeric "
        "WHEN {o} AND {k} ? '$numberDecimal' THEN ({k} ->> '$numberDecimal')::numeric "
        "WHEN {o} AND {k} ? '$numberLong' THEN ({k} ->> '$numberLong')::numeric "
        "WHEN {o} AND {k} ? '$numberDouble' THEN (CASE {k} ->> '$numberDouble' WHEN 'Infinity' THEN 'Infinity'::numeric "
        "ELSE '-Infinity'::numeric END) END)").format(k=k, t=typ, o=is_obj)
    text = sql.SQL("((CASE WHEN {t} = 'string' THEN {k} #>> '{{}}' END) COLLATE \"C\")").format(k=k, t=typ)
    oid = sql.SQL("((CASE WHEN {o} AND {k} ? '$oid' THEN {k} ->> '$oid' END) COLLATE \"C\")").format(k=k, o=is_obj)
    boolean = sql.SQL("(CASE WHEN {t} = 'boolean' THEN ({k})::boolean END)").format(k=k, t=typ)
    date = sql.SQL("(CASE WHEN {o} AND {k} ? '$date' THEN {ts} END)").format(k=k, o=is_obj, ts=_ts(k))
    return [rank, number, text, oid, boolean, date, k]


def _sort_keys(base, parts, depth: int = 0) -> sql.Composable:
    """SELECT con las llaves de orden de la ruta (como Mongo: cada elemento de un arreglo
    final cuenta; un elemento intermedio que no es objeto aporta null)."""
    value = sql.SQL("({} -> {})").format(base, sql.Literal(parts[0]))
    as_array = sql.SQL("(CASE WHEN jsonb_typeof({v}) = 'array' THEN {v} ELSE '[]'::jsonb END)").format(v=value)
    t, e = sql.Identifier(f"_st{depth}"), sql.Identifier(f"_se{depth}")
    if len(parts) == 1:
        return sql.SQL(
            "SELECT {e} FROM jsonb_array_elements({arr}) AS {t}({e}) "
            "UNION ALL SELECT CASE WHEN {v} IS NULL THEN 'null'::jsonb "
            "WHEN jsonb_typeof({v}) = 'array' THEN '{{\"$emptyArray\": 1}}'::jsonb ELSE {v} END "
            "WHERE jsonb_array_length({arr}) = 0").format(v=value, arr=as_array, t=t, e=e)
    return sql.SQL(
        "SELECT _k FROM ({in_obj}) AS {s1}(_k) WHERE {v_doc} "
        "UNION ALL SELECT _k FROM jsonb_array_elements({arr}) AS {t}({e}), LATERAL ({in_elem}) AS {s2}(_k) "
        "WHERE {e_doc} "
        "UNION ALL SELECT 'null'::jsonb FROM jsonb_array_elements({arr}) AS {t}({e}) WHERE NOT {e_doc} "
        "UNION ALL SELECT 'null'::jsonb WHERE NOT {v_doc} AND jsonb_array_length({arr}) = 0"
    ).format(v_doc=_is_doc(value), e_doc=_is_doc(e), arr=as_array, t=t, e=e,
             s1=sql.Identifier(f"_so{depth}"), s2=sql.Identifier(f"_sa{depth}"),
             in_obj=_sort_keys(value, parts[1:], depth + 1), in_elem=_sort_keys(e, parts[1:], depth + 1))


def sort_plan(sort) -> SortPlan:
    """ORDER BY equivalente al sort de Mongo. Sin sort: orden de inserción (seq)."""
    items = sort_items(sort)
    columns, order = [], []
    for i, (field, direction) in enumerate(items):
        parts = _parts(field)
        word = sql.SQL("ASC" if direction == 1 else "DESC")
        no_arrays = sql.SQL(" AND ").join(
            sql.SQL("jsonb_typeof(doc #> {}) IS DISTINCT FROM 'array'").format(sql.Literal(parts[:j + 1]))
            for j in range(len(parts)))
        pick = sql.SQL("(SELECT _k FROM ({keys}) AS _ks(_k) ORDER BY {by} LIMIT 1)").format(
            keys=_sort_keys(sql.SQL("doc"), parts),
            by=sql.SQL(", ").join(sql.SQL("{} {}").format(c, word) for c in _components(sql.Identifier("_k"))))
        # Caso común (sin arreglos en la ruta): el valor directo, sin subconsulta. Faltante = null
        # (en Mongo empatan; un NULL de SQL iría al final).
        name = sql.Identifier(f"_s{i}")
        columns.append(sql.SQL("(CASE WHEN {simple} THEN COALESCE(doc #> {path}, 'null'::jsonb) ELSE {pick} END) AS {name}").format(
            simple=no_arrays, path=sql.Literal(parts), pick=pick, name=name))
        order.extend(sql.SQL("{} {}").format(c, word) for c in _components(sql.SQL("_sort.{}").format(name)))
    order.append(sql.SQL("seq ASC"))
    lateral = sql.SQL("LATERAL (SELECT {}) AS _sort").format(sql.SQL(", ").join(columns)) if columns else None
    return SortPlan(lateral, sql.SQL(", ").join(order))


# ── Proyección ─────────────────────────────────────────────────────────────────
_MISSING = object()


def _projection_tree(paths) -> dict:
    tree = {}
    for path in paths:
        parts = _parts(path)
        node = tree
        for part in parts[:-1]:
            child = node.setdefault(part, {})
            if child is True:
                raise Unsupported(f"rutas que chocan en la proyección: {path}")
            node = child
        if parts[-1] in node:
            raise Unsupported(f"rutas que chocan en la proyección: {path}")
        node[parts[-1]] = True
    return tree


def _include(value, tree):
    if tree is True:
        return value
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            if key in tree:
                kept = _include(item, tree[key])
                if kept is not _MISSING:
                    out[key] = kept
        return out
    if isinstance(value, list):
        return [_include(item, tree) for item in value if isinstance(item, (dict, list))]
    return _MISSING


def _exclude(value, tree):
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            sub = tree.get(key)
            if sub is True:
                continue
            out[key] = _exclude(item, sub) if sub else item
        return out
    if isinstance(value, list):
        return [_exclude(item, tree) if isinstance(item, (dict, list)) else item for item in value]
    return value


def check_projection(projection):
    """Valida antes de prometer un cursor de Postgres (lo raro → Unsupported → Mongo)."""
    if not projection:
        return
    if isinstance(projection, (list, tuple)):
        projection = {f: 1 for f in projection}
    if not isinstance(projection, dict):
        raise Unsupported("proyección no es dict")
    for value in projection.values():
        if not isinstance(value, (bool, int, float)):
            raise Unsupported("proyección con operadores o expresiones")
    fields = {k: v for k, v in projection.items() if k != "_id"}
    if len({bool(v) for v in fields.values()}) > 1:
        raise Unsupported("proyección que mezcla incluir y excluir")
    _projection_tree(fields)


def apply_projection(doc: dict, projection) -> dict:
    """Proyección de Mongo (incluir/excluir, rutas punteadas que entran en arreglos).
    Nunca modifica `doc`."""
    if not projection:
        return doc
    if isinstance(projection, (list, tuple)):
        projection = {f: 1 for f in projection}
    check_projection(projection)
    include_id = bool(projection.get("_id", 1))
    fields = {k: v for k, v in projection.items() if k != "_id"}
    if not fields:
        if include_id:
            return {"_id": doc["_id"]} if "_id" in doc else {}
        return {k: v for k, v in doc.items() if k != "_id"}
    tree = _projection_tree(fields)
    if bool(next(iter(fields.values()))):
        out = _include(doc, tree)
        return {"_id": doc["_id"], **out} if include_id and "_id" in doc else out
    out = _exclude(doc, tree)
    if not include_id:
        out.pop("_id", None)
    return out


# ── Valores de una ruta (distinct) ─────────────────────────────────────────────
def path_values(doc, field: str) -> list:
    """Valores de `field` en un documento como los ve distinct de Mongo: los arreglos
    intermedios se recorren por sus elementos-objeto y el arreglo final se desenvuelve."""
    out = []

    def walk(node, parts):
        if not isinstance(node, dict) or parts[0] not in node:
            return
        value = node[parts[0]]
        if len(parts) == 1:
            if isinstance(value, list):
                out.extend(value)
            else:
                out.append(value)
            return
        if isinstance(value, dict):
            walk(value, parts[1:])
        elif isinstance(value, list):
            for item in value:
                walk(item, parts[1:])

    walk(doc, _parts(field))
    return out


def distinct_marker(value):
    """Igualdad de distinct: 1 y 1.0 son el mismo valor en Mongo."""
    if isinstance(value, (int, float)) and not isinstance(value, bool) and (not isinstance(value, float) or math.isfinite(value)):
        return ("n", Decimal(value))
    return ("v", codec.encode_doc({"v": value}))
