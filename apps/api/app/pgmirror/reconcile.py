"""Conciliación Mongo ⇄ Postgres de una colección (también sirve de carga inicial).

Compara cada documento por su huella (codec.doc_hash): faltantes en Postgres,
sobrantes en Postgres y distintos. Con fix=True copia lo faltante/distinto desde
Mongo y borra lo sobrante. Solo LEE Mongo. Los documentos que cambian mientras
corre pueden salir como diferencia momentánea: se corre dos veces y la segunda
debe dar cero.
"""
from app.pgmirror import codec

BATCH = 500


def reconcile(raw_db, store, collection: str, *, fix: bool = False, samples: int = 5) -> dict:
    pg_hashes = store.hashes(collection)
    seen = set()
    missing, different = [], []
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
        if fix:
            to_copy.append(doc)
            if len(to_copy) >= BATCH:
                copied += store.upsert(collection, to_copy)
                to_copy = []
    extra = [key for key in pg_hashes if key not in seen]
    deleted = 0
    if fix:
        copied += store.upsert(collection, to_copy)
        deleted = store.delete(collection, extra)
    return {
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
