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
  el equivalente del orden natural de Mongo). La llave de orden la calcula una función
  de Postgres (SORT_KEY_DDL) para que un índice pueda servirla (store.ensure_sort_index).
- Velocidad: a la condición exacta se le agrega otra NECESARIA que sí usa índices
  (contención para el índice GIN, llave de orden para los rangos); el resultado no cambia.
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


def field_parts(field) -> list[str]:
    """Partes de una ruta a.b.c; Unsupported si la ruta es ambigua o inválida."""
    return _parts(field)


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
_EJSON_ARRAY = ("array['$oid', '$date', '$numberDecimal', '$numberDouble', '$numberLong', '$binary', '$regularExpression', "
                "'$timestamp', '$minKey', '$maxKey', '$symbol', '$code', '$dbPointer', '$undefined', '$uuid', '$nulstr']")
_EJSON_KEYS = sql.SQL(_EJSON_ARRAY)


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


# ── Llave de orden ─────────────────────────────────────────────────────────────
# Una sola llave compuesta por valor, en el orden de tipos de BSON:
#   (vacío) < null < números < textos < objetos < arreglos < binarios < ObjectId < bool < fechas
# r = rango del tipo; n = número, bool (0/1) o fecha (ms desde 1970); t = texto u ObjectId (COLLATE "C");
# k = el valor mismo, solo para los tipos sin llave propia. Al comparar compuestos, Postgres
# toma NULL como mayor que cualquier valor, igual en ORDER BY, en índices y dentro de las funciones.
# Las funciones son IMMUTABLE (nunca fallan: un índice que falla bloquearía las escrituras del
# espejo) para que un índice de expresión sirva el ORDER BY y los rangos. La versión va en el
# nombre: si la semántica cambia se crea sortkey_v2 con índices nuevos; NUNCA se reemplaza una
# función existente (sus índices quedarían desordenados).
SORT_KEY_CHECK = "mongo.sortkey_v1_pick(jsonb, text[], integer)"
SORT_KEY_DDL = [
    'CREATE TYPE mongo.sortkey_v1 AS (r integer, n numeric, t text COLLATE "C", k jsonb)',
    r"""CREATE FUNCTION mongo.sortkey_v1_of(v jsonb) RETURNS mongo.sortkey_v1
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $fn$
DECLARE
  o mongo.sortkey_v1;
  typ text := jsonb_typeof(v);
  s text;
  zl integer; y integer; mo integer; era integer; yoe integer; doe integer; days bigint;
BEGIN
  IF typ IS NULL OR typ = 'null' THEN
    o.r := 1;
  ELSIF typ = 'number' THEN
    o.r := 2; o.n := v::numeric;
  ELSIF typ = 'string' THEN
    o.r := 3; o.t := v #>> '{}';
  ELSIF typ = 'boolean' THEN
    o.r := 8; o.n := CASE WHEN v::boolean THEN 1 ELSE 0 END;
  ELSIF typ = 'array' THEN
    o.r := 5; o.k := v;
  ELSIF v ? '$emptyArray' THEN
    o.r := 0;
  ELSIF v ? '$oid' THEN
    o.r := 7; o.t := v ->> '$oid';
  ELSIF v ? '$date' THEN
    -- "2026-10-20T12:00:00Z", con .mmm y/o desfase ±HHMM; fuera de 1970-9999, {"$numberLong": ms}.
    -- Se calcula con aritmética (días desde 1970) y no con ::timestamptz, que depende de la sesión.
    -- Se valida con ~ y se corta con substr: regexp_match con grupos tardaba ~190 µs por fecha.
    o.r := 9;
    s := v ->> '$date';
    IF jsonb_typeof(v -> '$date') = 'string' THEN
      IF s ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:?\d\d)$' THEN
        zl := CASE WHEN right(s, 1) = 'Z' THEN 1 WHEN substr(s, length(s) - 2, 1) = ':' THEN 6 ELSE 5 END;
        mo := substr(s, 6, 2)::integer;
        y := substr(s, 1, 4)::integer - CASE WHEN mo <= 2 THEN 1 ELSE 0 END;
        era := (CASE WHEN y >= 0 THEN y ELSE y - 399 END) / 400;
        yoe := y - era * 400;
        doe := yoe * 365 + yoe / 4 - yoe / 100 + (153 * (mo + CASE WHEN mo > 2 THEN -3 ELSE 9 END) + 2) / 5
               + substr(s, 9, 2)::integer - 1;
        days := era::bigint * 146097 + doe - 719468;
        o.n := (((days * 24 + substr(s, 12, 2)::integer) * 60 + substr(s, 15, 2)::integer) * 60
                + substr(s, 18, 2)::integer) * 1000::numeric
               + CASE WHEN length(s) - zl > 19 THEN ('0' || substr(s, 20, length(s) - zl - 19))::numeric * 1000 ELSE 0 END
               - CASE WHEN zl = 1 THEN 0
                      ELSE (CASE WHEN substr(s, length(s) - zl + 1, 1) = '-' THEN -1 ELSE 1 END)
                           * (substr(s, length(s) - zl + 2, 2)::integer * 60 + right(s, 2)::integer) * 60000 END;
      END IF;
    ELSIF (v -> '$date' ->> '$numberLong') ~ '^-?\d{1,20}$' THEN
      o.n := (v -> '$date' ->> '$numberLong')::numeric;
    END IF;
  ELSIF v ?| array['$numberDecimal', '$numberDouble', '$numberLong'] THEN
    o.r := 2;
    s := COALESCE(v ->> '$numberDecimal', v ->> '$numberLong', v ->> '$numberDouble');
    -- Largo y exponente acotados (Decimal128: 34 dígitos, exponente ±6176): el cast nunca desborda.
    IF (length(s) <= 64 AND s ~* '^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d{1,4})?$') OR s ~* '^[+-]?inf(inity)?$' THEN
      o.n := s::numeric;
    ELSE
      o.n := '-Infinity'::numeric;  -- NaN: Mongo lo pone antes que cualquier otro número
    END IF;
  ELSIF v ? '$binary' THEN
    o.r := 6; o.k := v;
  ELSIF v ? '$timestamp' THEN
    o.r := 10; o.k := v;
  ELSIF v ? '$regularExpression' THEN
    o.r := 11; o.k := v;
  ELSE
    o.r := 4; o.k := v;
  END IF;
  RETURN o;
END
$fn$""",
    # Como Mongo: cada elemento de un arreglo final es candidato (el menor para dir=1, el mayor
    # para dir=-1), el arreglo vacío ordena antes que null y en una ruta a.b se entra en los
    # elementos-objeto de los arreglos intermedios (un elemento que no es objeto cuenta como null).
    r"""CREATE FUNCTION mongo.sortkey_v1_pick(base jsonb, path text[], dir integer) RETURNS mongo.sortkey_v1
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $fn$
DECLARE
  v jsonb := base -> path[1];
  last boolean := cardinality(path) = 1;
  e jsonb;
  cand mongo.sortkey_v1;
  best mongo.sortkey_v1;
  found boolean := false;
BEGIN
  IF NOT last AND jsonb_typeof(v) = 'object' AND NOT (v ?| """ + _EJSON_ARRAY + r""") THEN
    RETURN mongo.sortkey_v1_pick(v, path[2:], dir);
  END IF;
  IF v IS NULL OR jsonb_typeof(v) <> 'array' THEN
    RETURN mongo.sortkey_v1_of(CASE WHEN last THEN v END);
  END IF;
  IF jsonb_array_length(v) = 0 THEN
    RETURN mongo.sortkey_v1_of(CASE WHEN last THEN '{"$emptyArray": 1}'::jsonb END);
  END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(v) AS a(x) LOOP
    IF last THEN
      cand := mongo.sortkey_v1_of(e);
    ELSIF jsonb_typeof(e) = 'object' AND NOT (e ?| """ + _EJSON_ARRAY + r""") THEN
      cand := mongo.sortkey_v1_pick(e, path[2:], dir);
    ELSE
      cand := mongo.sortkey_v1_of(NULL);
    END IF;
    IF NOT found OR (dir = 1 AND cand < best) OR (dir <> 1 AND cand > best) THEN
      best := cand;
      found := true;
    END IF;
  END LOOP;
  RETURN best;
END
$fn$""",
]


def sort_key(field: str, direction: int) -> sql.Composable:
    """Llave de orden de Mongo de `field` en cada fila. El mismo texto sirve para ORDER BY y para
    el índice (store.ensure_sort_index): Postgres solo usa el índice si la expresión es idéntica."""
    return sql.SQL("mongo.sortkey_v1_pick(doc, {}, {})").format(sql.Literal(_parts(field)), sql.Literal(int(direction)))


def _value_key(value) -> sql.Composable:
    """Llave de orden de un valor del filtro (constante: Postgres la calcula una vez al planear)."""
    return sql.SQL("mongo.sortkey_v1_of({})").format(_jsonb(value))


# ── Condiciones ────────────────────────────────────────────────────────────────
_GIN_MAX_VALUES = 20  # un $in más largo de ObjectId/fechas no agrega la condición para el índice (demasiadas ramas)


def _eq(field: str, value, gin: bool = True) -> sql.Composable:
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
    parts = _parts(field)
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
    exact = _walk(sql.SQL("doc"), parts, terminal, missing=value is None)
    if len(parts) == 1 and value is not None and not isinstance(value, (dict, list)):
        # Valor igual o arreglo que lo contiene como elemento, con contención: la única forma que
        # usa el índice GIN (jsonb_path_ops) de la tabla.
        encoded = codec.encode_value(value)
        contains = sql.SQL("(doc @> {}::jsonb OR doc @> {}::jsonb)").format(
            sql.Literal(json.dumps({parts[0]: encoded})), sql.Literal(json.dumps({parts[0]: [encoded]})))
        if not isinstance(encoded, dict):
            # Texto, número o bool: la contención ES la igualdad de arriba (jsonb compara escalares
            # igual que `=` y no busca escalares dentro de arreglos anidados), y lee el documento
            # 2 veces en vez de 5: en message_logs (documentos comprimidos) eso es lo que más cuesta.
            return contains
        if gin:
            # ObjectId, fecha…: {"$oid": …} podría contenerse en un objeto más grande; queda la
            # exacta y la contención solo como condición necesaria para el índice.
            return sql.SQL("({} AND {})").format(exact, contains)
    return exact


def _en_lista(field: str, values) -> sql.Composable | None:
    """$in largo de textos/números/bool en un campo de primer nivel: el valor (o un elemento del arreglo)
    está en la lista. Lo mismo que la contención de cada valor, pero el campo se lee una vez y Postgres
    busca en la lista con hash: contacts de 100 empresas tardaba 210 ms (2026-10-21). None si no aplica."""
    parts = _parts(field)
    # _id ya va por la llave primaria; None y regex tienen su propia semántica. ObjectId y fechas sí: _eq
    # también los compara por igualdad del valor (contacts.company_id mezcla texto y ObjectId: 842 → 46 ms).
    if field == "_id" or len(parts) != 1 or not all(isinstance(v, (str, int, float, ObjectId, datetime)) for v in values):
        return None
    for v in values:
        _check_value(v)
    x = sql.SQL("(doc -> {})").format(sql.Literal(parts[0]))
    lista = sql.SQL("ARRAY[{}]::jsonb[]").format(sql.SQL(", ").join(sql.Literal(json.dumps(codec.encode_value(v))) for v in values))
    return sql.SQL("COALESCE({x} = ANY({l}) OR (jsonb_typeof({x}) = 'array' AND EXISTS ("
                   "SELECT 1 FROM jsonb_array_elements({x}) AS _in(_e) WHERE _e = ANY({l}))), false)").format(x=x, l=lista)


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
    exact = _walk(sql.SQL("doc"), _parts(field), _or_any_element(scalar), missing=False)
    # Necesaria y servible por un índice de orden: si algún valor es ≥ v, la llave mayor (la de
    # sort desc) también lo es; si alguno es ≤ v, la menor (la de sort asc). Va después de la exacta
    # para que, sin índice, solo se calcule en las filas que ya cumplen.
    if op in ("$gt", "$gte"):
        bound = sql.SQL("{} >= {}").format(sort_key(field, -1), _value_key(value))
    else:
        bound = sql.SQL("{} <= {}").format(sort_key(field, 1), _value_key(value))
    return sql.SQL("({} AND {})").format(exact, bound)


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
            parts.append(sql.SQL("NOT {}").format(_eq(field, value, gin=False)))
        elif op in ("$in", "$nin"):
            if not isinstance(value, (list, tuple)):
                raise Unsupported(f"{op} sin lista")
            gin = op == "$in" and len(value) <= _GIN_MAX_VALUES
            if len(value) > _GIN_MAX_VALUES and (lista := _en_lista(field, value)) is not None:
                any_of = lista
            else:
                any_of = sql.SQL("({})").format(sql.SQL(" OR ").join(_eq(field, v, gin) for v in value)) if value else sql.SQL("false")
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
    order: sql.Composable  # cuerpo del ORDER BY


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


def sort_plan(sort) -> SortPlan:
    """ORDER BY equivalente al sort de Mongo. Sin sort (o en empates): orden de inserción (seq)."""
    order = [sql.SQL("{} {}").format(sort_key(field, direction), sql.SQL("ASC" if direction == 1 else "DESC"))
             for field, direction in sort_items(sort)]
    order.append(sql.SQL("seq ASC"))
    return SortPlan(sql.SQL(", ").join(order))


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
    for key, value in projection.items():
        if isinstance(value, dict) and _slice_spec(key, value) is not None:
            continue
        if not isinstance(value, (bool, int, float)):
            raise Unsupported("proyección con operadores o expresiones")
    fields = {k: v for k, v in projection.items() if k != "_id" and not isinstance(v, dict)}
    if any(isinstance(v, dict) for v in projection.values()) and fields and not all(bool(v) for v in fields.values()):
        raise Unsupported("proyección que mezcla $slice y excluir")
    if len({bool(v) for v in fields.values()}) > 1:
        raise Unsupported("proyección que mezcla incluir y excluir")
    _projection_tree(fields)


def _slice_spec(field, value):
    """{"$slice": n} o {"$slice": [saltar, cuántos]} sobre un campo de primer nivel; None si no lo es."""
    if not (isinstance(value, dict) and set(value) == {"$slice"}) or "." in field or field == "_id":
        if isinstance(value, dict):
            raise Unsupported(f"proyección con {sorted(value)}")
        return None
    spec = value["$slice"]
    if isinstance(spec, int) and not isinstance(spec, bool):
        return spec
    if (isinstance(spec, list) and len(spec) == 2 and all(isinstance(x, int) and not isinstance(x, bool) for x in spec)
            and spec[1] > 0):
        return tuple(spec)
    raise Unsupported(f"$slice {spec!r}")


def _rebanar(value, spec):
    if not isinstance(value, list):
        return value
    if isinstance(spec, int):
        return value[:spec] if spec >= 0 else value[spec:]
    skip, limit = spec
    start = skip if skip >= 0 else max(len(value) + skip, 0)
    return value[start:start + limit]


def apply_projection(doc: dict, projection) -> dict:
    """Proyección de Mongo (incluir/excluir, rutas punteadas que entran en arreglos, y $slice de un
    arreglo de primer nivel: la pantalla de sesiones de calentamiento pide el último mensaje).
    Nunca modifica `doc`."""
    if not projection:
        return doc
    if isinstance(projection, (list, tuple)):
        projection = {f: 1 for f in projection}
    check_projection(projection)
    slices = {k: _slice_spec(k, v) for k, v in projection.items() if isinstance(v, dict)}
    if slices:
        resto = {k: v for k, v in projection.items() if k not in slices}
        if any(bool(v) for k, v in resto.items() if k != "_id"):
            out = apply_projection(doc, {**resto, **{k: 1 for k in slices}})  # incluir: los rebanados también entran
        else:
            out = {k: v for k, v in doc.items() if not (k == "_id" and not resto.get("_id", 1))}
        return {k: (_rebanar(v, slices[k]) if k in slices else v) for k, v in out.items()}
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
