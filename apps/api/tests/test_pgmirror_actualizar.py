"""El motor de actualizaciones (app/pgmirror/actualizar.py) contra Mongo 7 REAL: el mismo update sobre
el mismo documento debe dejar exactamente el mismo documento (tipos y orden de llaves), y lo que en
Mongo es un error también lo es aquí. Necesita el Mongo de pruebas (127.0.0.1:27029); si no, se salta.
"""
import os
import random
import uuid
from datetime import datetime, timedelta

import pymongo
import pytest
from bson import ObjectId
from pymongo.errors import WriteError

from app.pgmirror import actualizar, codec

TEST_MONGO = os.getenv("TEST_MONGO_URL", "mongodb://127.0.0.1:27029")


def _mongo_disponible():
    try:
        client = pymongo.MongoClient(TEST_MONGO, serverSelectionTimeoutMS=1500)
        if type(client).__module__.startswith("mongomock"):
            return False
        client.admin.command("ping")
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _mongo_disponible(), reason="sin Mongo real de pruebas (27029)")
RUTAS = ["a", "b", "z", "c.d", "c.e", "n", "tags", "arr", "m.x.y"]


def _valor(r, profundo=True):
    return r.choice([
        None, 0, 1, -2, 2.5, 1.0, 10**12, True, False, "", "x", "Ñandú", "zeta",
        datetime(2026, r.randint(1, 12), r.randint(1, 28), r.randint(0, 23), 0, r.randint(0, 59), r.choice([0, 123456, 999000])),
        ObjectId("6716b0f2a1b2c3d4e5f60718"), [1, "x"], [],
        *([{"k": r.randint(0, 3)}, {"b": 1, "a": 2}, {"a": 2, "b": 1}] if profundo else []),
    ])


def _documento(r, i):
    doc = {"_id": i}
    for campo in r.sample(["a", "b", "z", "n", "tags", "arr", "c", "m"], r.randint(0, 6)):
        if campo == "n":
            doc[campo] = r.choice([0, 5, 2.5, "texto", None])
        elif campo in ("tags", "arr"):
            doc[campo] = r.choice([[], ["x", "y"], [1, 1.0, 2], [{"k": 1}], "no-arreglo"])
        elif campo == "c":
            doc[campo] = r.choice([{}, {"d": 1}, {"e": "x", "d": 2}, "escalar", None])
        elif campo == "m":
            doc[campo] = r.choice([{"x": {"y": 1}}, {"x": 3}, {}])
        else:
            doc[campo] = _valor(r)
    return doc


def _update(r):
    up = {}
    for _ in range(r.randint(1, 3)):
        op = r.choice(["$set", "$set", "$unset", "$inc", "$push", "$addToSet", "$pull", "$max", "$min", "$setOnInsert"])
        ruta = r.choice(RUTAS)
        if op == "$inc":
            valor = r.choice([1, -1, 2.5, 10**12])
        elif op == "$unset":
            valor = ""
        elif op == "$push":
            valor = r.choice([_valor(r), {"$each": [_valor(r, False), _valor(r, False)]},
                              {"$each": [1, 2, 3], "$slice": r.choice([-2, 0, 2])}])
        elif op == "$addToSet":
            valor = r.choice([_valor(r), {"$each": ["x", 1.0, "nuevo"]}])
        elif op == "$pull":
            valor = r.choice(["x", 1, {"$in": ["x", 2, {"k": 1}]}])
        elif op in ("$max", "$min"):
            valor = r.choice([0, 3, 7.5, "m", datetime(2026, 6, 1), datetime(2026, 6, 1, 0, 0, 0, 999)])
        else:
            valor = _valor(r)
        up.setdefault(op, {})[ruta] = valor
    return up


def _hash(doc):
    return codec.doc_hash(codec.decode_doc(codec.encode_doc(doc)))  # al milisegundo, como lo guarda Mongo


def _sin_orden(v):
    if isinstance(v, dict):
        return {k: _sin_orden(v[k]) for k in sorted(v)}
    if isinstance(v, list):
        return [_sin_orden(x) for x in v]
    return v


@pytest.fixture(scope="module")
def coleccion():
    client = pymongo.MongoClient(TEST_MONGO, serverSelectionTimeoutMS=3000)
    nombre = f"actualizar_{uuid.uuid4().hex[:8]}"
    yield client[nombre]["c"]
    client.drop_database(nombre)


def test_updates_leave_the_same_document_as_real_mongo(coleccion):
    r = random.Random(21)
    iguales = errores_iguales = no_soportados = 0
    distintos = []
    for i in range(1500):
        doc, update = _documento(r, i), _update(r)
        coleccion.insert_one(doc)
        antes = coleccion.find_one({"_id": i})
        try:
            esperado = actualizar.aplicar(antes, update)
            error_motor = None
        except actualizar.NoSoportado:
            no_soportados += 1
            continue
        except actualizar.ErrorDeMongo as exc:
            esperado, error_motor = None, exc
        try:
            coleccion.update_one({"_id": i}, update)
            error_mongo = None
        except WriteError as exc:
            error_mongo = exc
        despues = coleccion.find_one({"_id": i})
        if error_mongo or error_motor:
            if bool(error_mongo) == bool(error_motor):
                errores_iguales += 1
            else:
                distintos.append(f"{update!r} sobre {antes!r}: mongo={error_mongo!r} motor={error_motor!r}")
            continue
        if _hash(esperado) == _hash(despues):
            iguales += 1
        else:
            distintos.append(f"{update!r} sobre {antes!r}: mongo={despues!r} motor={esperado!r}")
    assert not distintos, "\n".join(distintos[:10])
    assert iguales > 900 and errores_iguales > 20, (iguales, errores_iguales, no_soportados)


def test_upserts_create_the_same_document_as_real_mongo(coleccion):
    r = random.Random(5)
    distintos = []
    for i in range(400):
        nuevo_id = ObjectId()
        filtro = {"_id": nuevo_id, **r.choice([{}, {"k": "v"}, {"k": "v", "a": 1}, {"z": 2, "b": {"$gt": 3}},
                                                 {"instance": "x", "date": "2026-10-21"}, {"c.d": 1}])}
        update = {k: v for k, v in _update(r).items()}
        update.setdefault("$set", {})["actualizado"] = datetime(2026, 10, 21, 12, 0, 0, 123456)
        try:
            esperado = actualizar.documento_de_upsert(filtro, update, nuevo_id)
        except (actualizar.NoSoportado, actualizar.ErrorDeMongo):
            continue
        try:
            coleccion.update_one(filtro, update, upsert=True)
        except WriteError:
            distintos.append(f"Mongo rechazó {update!r} con {filtro!r} y el motor no")
            continue
        despues = coleccion.find_one({"_id": nuevo_id})
        # El orden de los campos que salen del filtro no es determinista ni en Mongo 7 (medido: el mismo
        # upsert dejó «date, instance» y luego «instance, date»): aquí se compara el contenido.
        if _hash(_sin_orden(esperado)) != _hash(_sin_orden(despues)):
            distintos.append(f"{filtro!r} {update!r}: mongo={despues!r} motor={esperado!r}")
    assert not distintos, "\n".join(distintos[:10])


def test_what_the_app_does_today():
    """Formas reales de la app (daily_cap, proxies, scrape_jobs, contact_permissions)."""
    hoy = {"_id": 1, "instance": "gely-wa", "date": "2026-10-21", "recipients": ["5215511111111"], "companies": ["c1"]}
    assert actualizar.aplicar(hoy, {"$addToSet": {"recipients": "5215511111111"}})["recipients"] == ["5215511111111"]
    assert actualizar.aplicar(hoy, {"$pull": {"recipients": "5215511111111"}})["recipients"] == []
    proxy = {"_id": 1, "exit_ip_history": [{"to": str(i)} for i in range(30)]}
    nuevo = actualizar.aplicar(proxy, {"$inc": {"exit_ip_change_count": 1},
                                       "$push": {"exit_ip_history": {"$each": [{"to": "nuevo"}], "$slice": -30}}})
    assert len(nuevo["exit_ip_history"]) == 30 and nuevo["exit_ip_history"][-1] == {"to": "nuevo"} and nuevo["exit_ip_change_count"] == 1
    trabajo = {"_id": 1, "current_urls": ["a", "b", "c"]}
    assert actualizar.aplicar(trabajo, {"$pull": {"current_urls": {"$in": ["a", "c"]}}})["current_urls"] == ["b"]
    permiso = {"_id": 1, "granted_at": datetime(2026, 10, 1)}
    assert actualizar.aplicar(permiso, {"$max": {"granted_at": datetime(2026, 10, 2)}})["granted_at"] == datetime(2026, 10, 2)
    assert actualizar.aplicar(permiso, {"$max": {"granted_at": datetime(2026, 9, 2)}})["granted_at"] == datetime(2026, 10, 1)
    with pytest.raises(actualizar.NoSoportado):
        actualizar.aplicar(hoy, {"$rename": {"a": "b"}})
    with pytest.raises(actualizar.NoSoportado):
        actualizar.aplicar(hoy, {"$set": {"recipients.0": "x"}})
    assert hoy["recipients"] == ["5215511111111"]  # nunca modifica el original
    _ = timedelta  # (importado para casos futuros con fechas relativas)
