"""Documento de Mongo ⇄ jsonb sin pérdida.

Se usa Extended JSON relajado de MongoDB: un ObjectId queda como {"$oid": "…"} y
una fecha como {"$date": "…Z"}, así al volver se reconstruye el mismo tipo (la
base mezcla company_id como texto y como ObjectId; perder esa diferencia
cambiaría resultados). Postgres no acepta el carácter NUL dentro de jsonb: los
textos que lo traen se guardan envueltos en {"$nulstr": "<base64>"}.

jsonb reordena las llaves de los objetos; por eso la tabla guarda además el texto
exacto (columna src) y los documentos se reconstruyen desde ahí, con su orden.
"""
import base64
import hashlib
import json

from bson import ObjectId, json_util
from bson.int64 import Int64
from bson.json_util import JSONMode, JSONOptions

_RELAXED = JSONOptions(json_mode=JSONMode.RELAXED, tz_aware=False)
_CANONICAL = JSONOptions(json_mode=JSONMode.CANONICAL, tz_aware=False)
_NUL_KEY = "$nulstr"


def _wrap_nul(value):
    if isinstance(value, str):
        return {_NUL_KEY: base64.b64encode(value.encode("utf-8")).decode("ascii")} if "\x00" in value else value
    if isinstance(value, dict):
        return {k: _wrap_nul(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_wrap_nul(v) for v in value]
    return value


def _unwrap_nul(value):
    if isinstance(value, dict):
        if len(value) == 1 and _NUL_KEY in value:
            return base64.b64decode(value[_NUL_KEY]).decode("utf-8")
        return {k: _unwrap_nul(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_unwrap_nul(v) for v in value]
    return value


def encode_doc(doc: dict) -> str:
    """Texto JSON listo para una columna jsonb."""
    text = json_util.dumps(doc, json_options=_RELAXED)
    if "\\u0000" in text:
        text = json_util.dumps(_wrap_nul(doc), json_options=_RELAXED)
    return text


def decode_doc(data) -> dict:
    """De vuelta a un dict como el que regresa pymongo (fechas sin zona, en UTC)."""
    text = data if isinstance(data, str) else json.dumps(data)
    doc = json_util.loads(text, json_options=_RELAXED)
    return _unwrap_nul(doc) if _NUL_KEY in text else doc


def encode_value(value):
    """Un valor de filtro con la misma forma que tendría dentro del jsonb."""
    return json.loads(json_util.dumps({"v": value}, json_options=_RELAXED))["v"]


def id_key(value) -> tuple[str, str]:
    """(texto, tipo) del _id: la llave primaria de la tabla espejo."""
    if isinstance(value, ObjectId):
        return str(value), "objectId"
    if isinstance(value, str):
        return value, "string"
    if isinstance(value, bool):
        return json_util.dumps(value), "json"
    if isinstance(value, int):
        return str(value), "int"
    return json_util.dumps(value, json_options=_CANONICAL, sort_keys=True), "json"


def id_from_key(text: str, kind: str):
    if kind == "objectId":
        return ObjectId(text)
    if kind == "string":
        return text
    if kind == "int":
        return int(text)
    return json_util.loads(text, json_options=_CANONICAL)


def _plain_ints(value):
    # int32 e int64 son el mismo número para la app y para las consultas de Mongo, y el
    # jsonb relajado no guarda el ancho (fs.files.length es int64 y vuelve como int).
    if isinstance(value, Int64):
        return int(value)
    if isinstance(value, dict):
        return {k: _plain_ints(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_plain_ints(v) for v in value]
    return value


def doc_hash(doc: dict) -> str:
    """Huella del contenido para comparar Mongo vs Postgres: tipos y orden de las llaves
    incluidos (Mongo y la app conservan ese orden), salvo el ancho de los enteros."""
    canonical = json_util.dumps(_plain_ints(doc), json_options=_CANONICAL)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
