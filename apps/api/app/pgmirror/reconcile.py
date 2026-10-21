"""Conciliación Mongo ⇄ Postgres de una colección (también sirve de carga inicial).

Compara cada documento por su huella (codec.doc_hash): faltantes en Postgres,
sobrantes en Postgres y distintos. Con fix=True copia lo faltante/distinto desde
Mongo y borra lo sobrante. Solo LEE Mongo. Los documentos que cambian mientras
corre pueden salir como diferencia momentánea: se corre dos veces y la segunda
debe dar cero. Para acortar esa ventana, cada lote se vuelve a leer de Mongo justo
antes de copiarlo. (La conciliación automática del backend, health.py, ni siquiera
copia: manda los _id al SyncWorker, que relee al aplicar.)
"""
from app.pgmirror import codec

BATCH = 500


def _copy_fresh(raw_db, store, collection, docs) -> int:
    if not docs:
        return 0
    return store.replace_from_source(collection, [d["_id"] for d in docs],
                                     lambda ids: list(raw_db[collection].find({"_id": {"$in": ids}})))


def still_different(raw_db, store, collection: str, mongo_ids: list, extra_keys: list) -> tuple[list, list]:
    """Vuelve a comparar, en este momento, solo esos documentos. reconcile() lee las huellas de
    Postgres y luego recorre Mongo: lo que la app escribió entre una lectura y otra sale distinto
    aunque el espejo en vivo lo copie un segundo después (contacts, 2026-10-21: el verificador de
    WhatsApp escribe uno cada ~30 s). Devuelve (mongo_ids, extra_keys) de lo que sigue sin cuadrar."""
    ids = {codec.id_key(i)[0]: i for i in mongo_ids}
    ids.update({codec.id_key(i)[0]: i for i in store.id_values(collection, list(extra_keys))})
    if not ids:
        return [], []
    pg = store.hashes(collection, list(ids))
    mongo = {codec.id_key(d["_id"])[0]: codec.doc_hash(d)
             for d in raw_db[collection].find({"_id": {"$in": list(ids.values())}})}
    left = [key for key in ids if mongo.get(key) != pg.get(key)]
    extra = set(extra_keys)
    return [ids[key] for key in left if key not in extra], [key for key in left if key in extra]


def reconcile(raw_db, store, collection: str, *, fix: bool = False, samples: int = 5, want_ids: bool = False) -> dict:
    pg_hashes = store.hashes(collection)
    seen = set()
    missing, different, mongo_ids = [], [], []
    to_copy = []
    copied = 0
    for doc in raw_db[collection].find({}, batch_size=BATCH):
        key, _ = codec.id_key(doc["_id"])
        seen.add(key)
        pg = pg_hashes.get(key)
        if pg is None:
            missing.append(key)
        elif pg != codec.doc_hash(doc):
            different.append(key)
        else:
            continue
        if want_ids:
            mongo_ids.append(doc["_id"])
        if fix:
            to_copy.append(doc)
            if len(to_copy) >= BATCH:
                copied += _copy_fresh(raw_db, store, collection, to_copy)
                to_copy = []
    extra = [key for key in pg_hashes if key not in seen]
    deleted = 0
    if fix:
        copied += _copy_fresh(raw_db, store, collection, to_copy)
        deleted = store.delete(collection, extra)
    ids = {"mongo_ids": mongo_ids, "extra_keys": extra} if want_ids else {}
    return {**ids,
        "collection": collection,
        "mongo": len(seen),
        "postgres_before": len(pg_hashes),
        "missing_in_postgres": len(missing),
        "different": len(different),
        "extra_in_postgres": len(extra),
        "in_sync": not (missing or different or extra),
        "copied": copied,
        "deleted": deleted,
        "samples": {"missing": missing[:samples], "different": different[:samples], "extra": extra[:samples]},
    }
