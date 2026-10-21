"""Modo «primary»: Postgres recibe las escrituras (fuente de verdad) y Mongo queda como copia.

Cada escritura es UNA transacción de Postgres con el motor de actualizaciones (actualizar.py, medido
contra Mongo 7): los documentos que cumplen el filtro se bloquean con SELECT … FOR UPDATE (si otro
proceso los cambió mientras se esperaba, Postgres vuelve a evaluar el filtro sobre la versión nueva),
se calcula el documento nuevo y se guarda. Un upsert toma antes un candado por su llave (el filtro),
así dos procesos no crean el mismo documento dos veces. Los índices únicos de Mongo existen también en
Postgres (store.UNICOS) y sus errores salen como los de pymongo (DuplicateKeyError).

La copia a Mongo va dentro de esa misma transacción, antes del COMMIT, con el candado por documento
que usan todas las copias (_row_lock): quien escribe en Mongo un documento siempre trae su versión más
nueva. Si Mongo falla (o se cayó hace menos de 30 s), la escritura NO falla: esos _id se anotan en la
bandeja de salida (mongo._outbox) en la misma transacción y el vigilante (health.py) los copia cuando
Mongo vuelva. Si lo que falla es el COMMIT, Mongo se regresa a lo que tiene Postgres.

Lo que el motor no sabe hacer (NoSoportado, o un filtro que sqlfilter no traduce) no se adivina:
por_mongo() lo hace en Mongo con esos documentos bloqueados en Postgres y deja el resultado en
Postgres en la misma transacción.
"""
import contextlib
import hashlib
import logging
import time

import pymongo
from bson import ObjectId
from psycopg import errors as pg_errors
from psycopg import sql
from pymongo import DeleteOne, ReplaceOne, ReturnDocument
from pymongo.errors import BulkWriteError, DuplicateKeyError, OperationFailure, WriteError
from pymongo.results import DeleteResult, InsertManyResult, InsertOneResult, UpdateResult

from app.pgmirror import actualizar, codec, sqlfilter
from app.pgmirror.store import _LOCK_NAMESPACE, UNICOS, _row_lock

log = logging.getLogger(__name__)
_REINTENTOS = 5
_CANDADO_UPSERT = 0x5055  # pg_advisory_xact_lock(int4, int4): upserts de la misma llave, uno a la vez
_REINTENTABLES = (pg_errors.DeadlockDetected, pg_errors.SerializationFailure)
_OTRA_VUELTA = object()
_TIEMPO_MONGO_S = 5  # la copia a Mongo no detiene una escritura más que esto
_PAUSA_MONGO_S = 30  # tras un Mongo caído, las copias van directo a la bandeja este tiempo
_mongo_caido_hasta = 0.0
OUTBOX_DDL = [
    "CREATE SEQUENCE IF NOT EXISTS mongo._outbox_seq",
    "CREATE TABLE IF NOT EXISTS mongo._outbox (collection text NOT NULL, id text NOT NULL, id_type text NOT NULL, "
    "seq bigint NOT NULL DEFAULT nextval('mongo._outbox_seq'), at timestamptz NOT NULL DEFAULT now(), "
    "PRIMARY KEY (collection, id))",
]

# Argumentos posicionales de pymongo 4, después del filtro y del documento/update.
_POSICIONALES = {
    "insert_one": (), "insert_many": ("ordered",),
    "update_one": ("upsert",), "update_many": ("upsert",), "replace_one": ("upsert",),
    "delete_one": (), "delete_many": (),
    "find_one_and_update": ("projection", "sort", "upsert", "return_document"),
    "find_one_and_replace": ("projection", "sort", "upsert", "return_document"),
    "find_one_and_delete": ("projection", "sort"),
}
_PERMITIDOS = {"upsert", "sort", "projection", "return_document", "ordered"}
_NEUTROS = {"bypass_document_validation", "collation", "array_filters", "hint", "session", "let", "comment"}


class _Fallo:
    """Un update_many que falló a la mitad: como en Mongo, lo anterior se queda."""

    def __init__(self, error):
        self.error = error


def _llave_upsert(coleccion: str, filtro) -> int:
    texto = coleccion + "\x1f" + codec.encode_doc({"f": filtro or {}})
    return int.from_bytes(hashlib.blake2b(texto.encode("utf-8"), digest_size=4).digest(), "big", signed=True)


def argumentos(metodo: str, args: tuple, kwargs: dict):
    """Los argumentos de pymongo como dict (sin los que valen su valor por defecto). None si sobran."""
    nombres = _POSICIONALES[metodo]
    if len(args) > len(nombres):
        return None
    kw = dict(zip(nombres, args))
    for k, v in kwargs.items():
        if k in kw:
            return None
        kw[k] = v
    return {k: v for k, v in kw.items() if not (k in _NEUTROS and v in (None, False))}


def soporta(metodo: str, update=None, kw=None) -> bool:
    """¿Se puede hacer en Postgres? (lo demás va por por_mongo)."""
    if kw is None or set(kw) - _PERMITIDOS:
        return False
    if metodo in ("update_one", "update_many", "find_one_and_update"):
        if not (isinstance(update, dict) and update and all(isinstance(k, str) and k.startswith("$") for k in update)):
            return False
        return all(op in actualizar.OPERADORES for op in update)
    return metodo in _POSICIONALES


def _escribir_en_mongo(raw, ops):
    with pymongo.timeout(_TIEMPO_MONGO_S):
        raw.bulk_write(ops, ordered=False)


def _candados(conn, coleccion, llaves):
    """El candado por documento de todas las copias (también la de Mongo → Postgres), en orden."""
    candados = sorted({_row_lock(coleccion, k) for k in llaves})
    if candados:
        conn.execute("SELECT pg_advisory_xact_lock(%s, k) FROM unnest(%s::int[]) AS k ORDER BY k",
                     (_LOCK_NAMESPACE, candados))


class Escritor:
    def __init__(self, store, coleccion: str, raw, on_evento=None):
        self._store, self._col, self._raw = store, coleccion, raw
        store.ensure_table(coleccion)
        self._t = store.table(coleccion)
        self._con_unicos = bool(UNICOS.get(coleccion))
        self._on_evento = on_evento

    def _evento(self, llave, n=1):
        if self._on_evento is not None:
            self._on_evento(llave, n)

    # ── piezas ────────────────────────────────────────────────────────────────
    def _bloquear(self, conn, filtro, sort=None, limite=None) -> list[dict]:
        consulta = sql.SQL("SELECT COALESCE(src, doc::text) FROM {} WHERE ").format(self._t) + sqlfilter.where(filtro)
        consulta += sql.SQL(" ORDER BY ") + (sqlfilter.sort_plan(sort).order if sort else sql.SQL("seq"))
        if limite:
            consulta += sql.SQL(" LIMIT {}").format(sql.Literal(int(limite)))
        consulta += sql.SQL(" FOR UPDATE")
        return [codec.decode_doc(r[0]) for r in conn.execute(consulta).fetchall()]

    def _existe(self, conn, filtro) -> bool:
        consulta = sql.SQL("SELECT EXISTS (SELECT 1 FROM {} WHERE ").format(self._t) + sqlfilter.where(filtro) + sql.SQL(")")
        return conn.execute(consulta).fetchone()[0]

    def _fila(self, doc):
        llave, tipo = codec.id_key(doc["_id"])
        texto = codec.encode_doc(doc)
        return llave, tipo, texto, codec.doc_hash(doc)

    def _guardar(self, conn, doc):
        llave, _tipo, texto, huella = self._fila(doc)
        self._ejecutar(conn, sql.SQL("UPDATE {} SET doc = %s::jsonb, src = %s, doc_hash = %s, synced_at = now() WHERE id = %s")
                       .format(self._t), (texto, texto, huella, llave))

    def _insertar(self, conn, doc):
        llave, tipo, texto, huella = self._fila(doc)
        fila = self._ejecutar(conn, sql.SQL(
            "INSERT INTO {} (id, id_type, doc, src, doc_hash, synced_at) VALUES (%s, %s, %s::jsonb, %s, %s, now()) "
            "ON CONFLICT (id) DO NOTHING RETURNING id").format(self._t), (llave, tipo, texto, texto, huella)).fetchone()
        if fila is None:
            raise DuplicateKeyError(f"E11000 duplicate key error collection: {self._col} index: _id_ dup key: "
                                    f"{{ _id: {doc['_id']!r} }}", 11000)

    def _escribir_fila(self, conn, doc):
        """Insertar o reemplazar (por_mongo: lo que dejó Mongo)."""
        llave, tipo, texto, huella = self._fila(doc)
        self._ejecutar(conn, sql.SQL(
            "INSERT INTO {} AS t (id, id_type, doc, src, doc_hash, synced_at) VALUES (%s, %s, %s::jsonb, %s, %s, now()) "
            "ON CONFLICT (id) DO UPDATE SET id_type = EXCLUDED.id_type, doc = EXCLUDED.doc, src = EXCLUDED.src, "
            "doc_hash = EXCLUDED.doc_hash, synced_at = now() WHERE t.src IS DISTINCT FROM EXCLUDED.src").format(self._t),
            (llave, tipo, texto, texto, huella))

    def _ejecutar(self, conn, consulta, params=None):
        try:
            return conn.execute(consulta, params)
        except pg_errors.UniqueViolation as exc:
            raise DuplicateKeyError(f"E11000 duplicate key error collection: {self._col} index: "
                                    f"{exc.diag.constraint_name}", 11000) from exc

    def _borrar(self, conn, ids):
        if ids:
            conn.execute(sql.SQL("DELETE FROM {} WHERE id = ANY(%s)").format(self._t), ([codec.id_key(i)[0] for i in ids],))

    def _marcar(self, conn, ids):
        """La bandeja de salida: estos _id cambiaron y Mongo todavía no lo sabe."""
        llaves = {}
        for i in ids:
            llave, tipo = codec.id_key(i)
            llaves[llave] = tipo
        if llaves:
            conn.execute("INSERT INTO mongo._outbox (collection, id, id_type) SELECT %s, k, t FROM unnest(%s::text[], %s::text[]) "
                         "AS u(k, t) ON CONFLICT (collection, id) DO UPDATE SET seq = nextval('mongo._outbox_seq'), at = now()",
                         (self._col, list(llaves), list(llaves.values())))

    def _reflejar(self, conn, cambios, copiados):
        """La copia a Mongo de lo que cambió, ANTES del COMMIT y con el candado por documento: (id, doc) o
        (id, None) si se borró. Si Mongo no responde, a la bandeja (la escritura no falla por eso)."""
        global _mongo_caido_hasta
        if not cambios:
            return
        _candados(conn, self._col, [codec.id_key(i)[0] for i, _ in cambios])
        ids = [i for i, _ in cambios]
        if self._raw is None or time.monotonic() < _mongo_caido_hasta:
            self._marcar(conn, ids)
            self._evento("copia_a_mongo_pendiente", len(ids))
            return
        ops = [ReplaceOne({"_id": i}, d, upsert=True) if d is not None else DeleteOne({"_id": i}) for i, d in cambios]
        copiados.extend(ids)  # si el COMMIT falla, estos se regresan a lo de Postgres
        try:
            _escribir_en_mongo(self._raw, ops)
            self._evento("copiado_a_mongo", len(ids))
        except Exception as exc:
            if not isinstance(exc, BulkWriteError):
                _mongo_caido_hasta = time.monotonic() + _PAUSA_MONGO_S
            self._marcar(conn, ids)
            self._evento("copia_a_mongo_pendiente", len(ids))
            log.warning("pgmirror: la copia a Mongo de %s quedó en la bandeja (%s)", self._col, exc)

    def _restaurar(self, ids):
        """Mongo ya recibió algo que Postgres no guardó (el COMMIT falló): Mongo vuelve a lo de Postgres."""
        if ids and self._raw is not None:
            try:
                copiar_a_mongo(self._raw, self._store, self._col, ids)
            except Exception:
                log.exception("pgmirror: no se pudo regresar la copia de Mongo de %s", self._col)

    @staticmethod
    def _id_nuevo(doc: dict):
        if "_id" not in doc:
            doc["_id"] = ObjectId()  # como pymongo: el dict de quien llama se queda con su _id
        return doc["_id"]

    @contextlib.contextmanager
    def _transaccion(self):
        with self._store._pool.connection() as conn, conn.transaction():
            yield conn

    def _intentar(self, paso):
        """paso(conn, copiados) en una transacción; otra vuelta si pide _OTRA_VUELTA o Postgres detecta un
        bloqueo mutuo (eso pasa antes de tocar Mongo: los candados se toman antes de copiar)."""
        for intento in range(_REINTENTOS):
            copiados = []
            try:
                with self._transaccion() as conn:
                    hecho = paso(conn, copiados)
            except _REINTENTABLES:
                self._restaurar(copiados)
                if intento == _REINTENTOS - 1:
                    raise
                continue
            except BaseException:
                self._restaurar(copiados)
                raise
            if hecho is not _OTRA_VUELTA:
                return hecho
        raise WriteError("pgmirror: el documento cambió en cada intento", 112)

    # ── operaciones (devuelven lo mismo que pymongo) ───────────────────────────
    def ejecutar(self, metodo: str, filtro, documento, kw: dict):
        upsert = bool(kw.get("upsert", False))
        if metodo == "insert_one":
            return self.insert_one(documento)
        if metodo == "insert_many":
            return self.insert_many(documento, ordered=kw.get("ordered", True))
        if metodo in ("update_one", "update_many", "replace_one"):
            return self.update(filtro, documento, multi=metodo == "update_many", upsert=upsert, reemplazo=metodo == "replace_one")
        if metodo in ("delete_one", "delete_many"):
            return self.delete(filtro, multi=metodo == "delete_many")
        return self.find_one_and_modify(
            filtro, documento, projection=kw.get("projection"), sort=kw.get("sort"), upsert=upsert,
            return_document=kw.get("return_document", ReturnDocument.BEFORE),
            borrar=metodo == "find_one_and_delete", reemplazo=metodo == "find_one_and_replace")

    def insert_one(self, documento: dict):
        _id = self._id_nuevo(documento)
        doc = codec.decode_doc(codec.encode_doc(documento))  # lo que de verdad se guarda (al ms)

        def paso(conn, copiados):
            self._insertar(conn, doc)
            self._reflejar(conn, [(_id, doc)], copiados)
        self._intentar(paso)
        return InsertOneResult(_id, True)

    def insert_many(self, documentos, ordered: bool = True):
        """Como pymongo: cada documento por su cuenta; ordenado se detiene en el primer error (los anteriores
        se quedan) y sin orden sigue; los errores salen como BulkWriteError."""
        documentos = list(documentos)
        if not documentos:
            raise TypeError("documents must be a non-empty list")
        ids, errores = [], []
        for indice, documento in enumerate(documentos):
            _id = self._id_nuevo(documento)
            try:
                self.insert_one(documento)
                ids.append(_id)
            except DuplicateKeyError as exc:
                errores.append({"index": indice, "code": 11000, "errmsg": str(exc), "op": documento})
                if ordered:
                    break
        if errores:
            raise BulkWriteError({"writeErrors": errores, "writeConcernErrors": [], "nInserted": len(ids), "nUpserted": 0,
                                  "nMatched": 0, "nModified": 0, "nRemoved": 0, "upserted": [], "insertedIds": ids})
        return InsertManyResult(ids, True)

    @staticmethod
    def _validar(update, reemplazo):
        """Mongo rechaza un update contradictorio aunque ningún documento cumpla el filtro."""
        if not reemplazo:
            try:
                actualizar._arbol(update, False)
            except actualizar.ErrorDeMongo as exc:
                raise WriteError(str(exc), 40) from exc

    def update(self, filtro, update, *, multi: bool, upsert: bool = False, sort=None, reemplazo: bool = False):
        self._validar(update, reemplazo)

        def paso(conn, copiados):
            if upsert:
                conn.execute("SELECT pg_advisory_xact_lock(%s, %s)", (_CANDADO_UPSERT, _llave_upsert(self._col, filtro)))
            docs = self._bloquear(conn, filtro, sort, None if multi else 1)
            if not docs and not multi and self._existe(conn, filtro):
                return _OTRA_VUELTA  # el candidato cambió mientras esperábamos y otro sí cumple: otra vuelta, como Mongo
            if not docs and upsert:
                nuevo = self._doc_upsert(filtro, update, reemplazo)
                self._insertar(conn, nuevo)
                self._reflejar(conn, [(nuevo["_id"], nuevo)], copiados)
                return UpdateResult({"n": 1, "nModified": 0, "upserted": nuevo["_id"], "updatedExisting": False}, True)
            cambios = []
            for doc in docs:
                try:
                    nuevo = self._calcular(doc, update, reemplazo)
                    if codec.encode_doc(nuevo) != codec.encode_doc(doc):
                        if multi and self._con_unicos:
                            with conn.transaction():  # savepoint: un índice único a la mitad no deshace lo anterior
                                self._guardar(conn, nuevo)
                        else:
                            self._guardar(conn, nuevo)
                        cambios.append((doc["_id"], nuevo))
                except WriteError as exc:
                    if not multi:
                        raise
                    # Como Mongo: update_many se detiene en el primer error y lo anterior se queda.
                    self._reflejar(conn, cambios, copiados)
                    return _Fallo(exc)
            self._reflejar(conn, cambios, copiados)
            return UpdateResult({"n": len(docs), "nModified": len(cambios), "updatedExisting": bool(docs)}, True)
        hecho = self._intentar(paso)
        if isinstance(hecho, _Fallo):
            raise hecho.error
        return hecho

    def delete(self, filtro, *, multi: bool):
        def paso(conn, copiados):
            docs = self._bloquear(conn, filtro, None, None if multi else 1)
            if not docs and not multi and self._existe(conn, filtro):
                return _OTRA_VUELTA
            ids = [d["_id"] for d in docs]
            self._borrar(conn, ids)
            self._reflejar(conn, [(i, None) for i in ids], copiados)
            return DeleteResult({"n": len(ids)}, True)
        return self._intentar(paso)

    def find_one_and_modify(self, filtro, update, *, projection=None, sort=None, upsert=False,
                            return_document=ReturnDocument.BEFORE, borrar=False, reemplazo=False):
        sqlfilter.check_projection(projection)
        if not borrar:
            try:
                self._validar(update, reemplazo)
            except WriteError as exc:
                raise OperationFailure(str(exc), exc.code) from exc

        def paso(conn, copiados):
            if upsert:
                conn.execute("SELECT pg_advisory_xact_lock(%s, %s)", (_CANDADO_UPSERT, _llave_upsert(self._col, filtro)))
            docs = self._bloquear(conn, filtro, sort, 1)
            if not docs and self._existe(conn, filtro):
                return _OTRA_VUELTA
            if not docs:
                if not upsert or borrar:
                    return None
                nuevo = self._doc_upsert(filtro, update, reemplazo)
                self._insertar(conn, nuevo)
                self._reflejar(conn, [(nuevo["_id"], nuevo)], copiados)
                devuelto = nuevo if return_document == ReturnDocument.AFTER else None
                return sqlfilter.apply_projection(devuelto, projection) if devuelto is not None else None
            antes = docs[0]
            if borrar:
                self._borrar(conn, [antes["_id"]])
                self._reflejar(conn, [(antes["_id"], None)], copiados)
                return sqlfilter.apply_projection(antes, projection)
            try:
                despues = self._calcular(antes, update, reemplazo)
            except WriteError as exc:
                # findAndModify no es una escritura de lote: pymongo levanta OperationFailure.
                raise OperationFailure(str(exc), exc.code) from exc
            if codec.encode_doc(despues) != codec.encode_doc(antes):
                self._guardar(conn, despues)
                self._reflejar(conn, [(antes["_id"], despues)], copiados)
            devuelto = despues if return_document == ReturnDocument.AFTER else antes
            return sqlfilter.apply_projection(devuelto, projection)
        return self._intentar(paso)

    # ── lo que el motor no hace: en Mongo, con los documentos bloqueados en Postgres ──
    def por_mongo(self, filtro, escribir, *, upsert: bool = False, nuevos=()):
        """escribir() hace la escritura en Mongo y devuelve su resultado. Antes se bloquean en Postgres los
        candidatos (los que el filtro encuentra en Mongo y, si se traduce, en Postgres) y Mongo se pone al
        día con ellos; después lo que quedó en Mongo se guarda en Postgres en la misma transacción. Si
        Postgres rechaza el resultado (un índice único), se deshace y Mongo vuelve a ser la copia."""
        raw = self._raw
        escrito = []

        def paso(conn, copiados):
            if escrito:
                # Mongo ya se escribió en un intento anterior: repetirlo aplicaría dos veces la escritura.
                raise WriteError("pgmirror: la escritura en Mongo no se puede repetir", 112)
            if upsert:
                conn.execute("SELECT pg_advisory_xact_lock(%s, %s)", (_CANDADO_UPSERT, _llave_upsert(self._col, filtro)))
            candidatos = {codec.id_key(i)[0]: i for i in nuevos}
            if filtro is not None:
                candidatos.update({codec.id_key(d["_id"])[0]: d["_id"] for d in raw.find(filtro, {"_id": 1})})
                try:
                    for d in self._bloquear(conn, filtro):
                        candidatos[codec.id_key(d["_id"])[0]] = d["_id"]
                except sqlfilter.Unsupported:
                    pass
            filas = dict(conn.execute(sql.SQL("SELECT id, COALESCE(src, doc::text) FROM {} WHERE id = ANY(%s) ORDER BY seq FOR UPDATE")
                                      .format(self._t), (list(candidatos),)).fetchall())
            _candados(conn, self._col, candidatos)
            self._igualar_mongo(candidatos, {k: codec.decode_doc(t) for k, t in filas.items()})
            escrito.append(True)
            copiados.extend(candidatos.values())  # si algo falla de aquí en adelante, Mongo vuelve a lo de Postgres
            resultado = escribir()
            tocados = dict(candidatos)
            extra = list(_ids_del_resultado(resultado))
            if upsert and filtro is not None:
                extra += [d["_id"] for d in raw.find(filtro, {"_id": 1})]
            nuevos_aqui = {codec.id_key(i)[0]: i for i in extra if codec.id_key(i)[0] not in tocados}
            if nuevos_aqui:
                _candados(conn, self._col, nuevos_aqui)
                tocados.update(nuevos_aqui)
                copiados.extend(nuevos_aqui.values())
            vivos = {codec.id_key(d["_id"])[0]: d for d in raw.find({"_id": {"$in": list(tocados.values())}})}
            for llave, _id in tocados.items():
                if llave in vivos:
                    self._escribir_fila(conn, vivos[llave])
                elif llave in filas:
                    self._borrar(conn, [_id])
            return resultado
        return self._intentar(paso)

    def _igualar_mongo(self, candidatos: dict, en_pg: dict):
        """Mongo igual a Postgres en esos documentos (casi siempre ya lo está: solo se reescribe lo distinto)."""
        if not candidatos:
            return
        en_mongo = {codec.id_key(d["_id"])[0]: d for d in self._raw.find({"_id": {"$in": list(candidatos.values())}})}
        ops = []
        for llave, _id in candidatos.items():
            pg, mongo = en_pg.get(llave), en_mongo.get(llave)
            if pg is None and mongo is not None:
                ops.append(DeleteOne({"_id": _id}))
            elif pg is not None and (mongo is None or codec.doc_hash(mongo) != codec.doc_hash(pg)):
                ops.append(ReplaceOne({"_id": _id}, pg, upsert=True))
        if ops:
            self._raw.bulk_write(ops, ordered=True)

    # ── documento nuevo ───────────────────────────────────────────────────────
    @staticmethod
    def _calcular(doc, update, reemplazo):
        if reemplazo:
            if "_id" in update and not codec.id_key(update["_id"]) == codec.id_key(doc["_id"]):
                raise WriteError("After applying the update, the (immutable) field '_id' was found to have been altered", 66)
            return codec.decode_doc(codec.encode_doc({"_id": doc["_id"], **{k: v for k, v in update.items() if k != "_id"}}))
        try:
            nuevo = actualizar.aplicar(doc, update)
        except actualizar.ErrorDeMongo as exc:
            raise WriteError(str(exc), 2) from exc
        return codec.decode_doc(codec.encode_doc(nuevo))

    def _doc_upsert(self, filtro, update, reemplazo):
        if reemplazo:
            _id = (filtro or {}).get("_id")
            if isinstance(_id, dict) or set(filtro or {}) - {"_id"}:
                raise actualizar.NoSoportado("replace upsert con un filtro de varios campos")
            nuevo = {"_id": update.get("_id", _id if _id is not None else ObjectId()), **{k: v for k, v in update.items() if k != "_id"}}
        else:
            try:
                nuevo = actualizar.documento_de_upsert(filtro, update, ObjectId())
            except actualizar.ErrorDeMongo as exc:
                raise WriteError(str(exc), 54) from exc
        return codec.decode_doc(codec.encode_doc(nuevo))


def _ids_del_resultado(resultado):
    if isinstance(resultado, dict) and "_id" in resultado:
        yield resultado["_id"]
    for attr in ("upserted_id", "inserted_id"):
        valor = getattr(resultado, attr, None)
        if valor is not None:
            yield valor
    for valor in getattr(resultado, "inserted_ids", None) or []:
        yield valor


def copiar_a_mongo(raw_collection, store, coleccion: str, ids) -> int:
    """Deja en Mongo esos documentos como están en Postgres (o los borra) y quita de la bandeja lo que
    copió (vigilante, conciliación y Mongo de regreso tras un COMMIT fallido). Toma el candado por
    documento de todas las copias. Los documentos y la bandeja se leen en UNA consulta (la misma foto):
    una escritura que llegue después deja su propia anotación."""
    llaves = {}
    for i in ids:
        if i is not None:
            llaves[codec.id_key(i)[0]] = i
    if not llaves:
        return 0
    with store._pool.connection() as conn, conn.transaction():
        _candados(conn, coleccion, llaves)
        filas = conn.execute(sql.SQL(
            "SELECT k.id, COALESCE(t.src, t.doc::text), o.seq FROM unnest(%s::text[]) AS k(id) "
            "LEFT JOIN {} t ON t.id = k.id LEFT JOIN mongo._outbox o ON o.collection = %s AND o.id = k.id")
            .format(store.table(coleccion)), (list(llaves), coleccion)).fetchall()
        ops, de_op, anotadas = [], [], []
        for llave, texto, seq in filas:
            _id = llaves[llave]
            ops.append(ReplaceOne({"_id": _id}, codec.decode_doc(texto), upsert=True) if texto is not None
                       else DeleteOne({"_id": _id}))
            de_op.append(llave)
            if seq is not None:
                anotadas.append((llave, seq))
        error = None
        try:
            _escribir_en_mongo(raw_collection, ops)
        except BulkWriteError as exc:
            # Un índice único de Mongo con una versión vieja de OTRO documento (que viene en camino):
            # lo que falló se intenta una vez más al final; si sigue, se queda en la bandeja.
            fallidas = sorted({e["index"] for e in exc.details.get("writeErrors", [])})
            try:
                _escribir_en_mongo(raw_collection, [ops[i] for i in fallidas])
            except BulkWriteError as otra:
                malas = {de_op[fallidas[e["index"]]] for e in otra.details.get("writeErrors", [])}
                anotadas = [(k, s) for k, s in anotadas if k not in malas]
                error = otra
        if anotadas:
            _quitar_de_bandeja(conn, coleccion, anotadas)
    if error is not None:
        raise error
    return len(llaves)


def _quitar_de_bandeja(conn, coleccion, anotadas):
    conn.execute("DELETE FROM mongo._outbox o USING unnest(%s::text[], %s::bigint[]) AS u(id, seq) "
                 "WHERE o.collection = %s AND o.id = u.id AND o.seq = u.seq",
                 ([k for k, _ in anotadas], [s for _, s in anotadas], coleccion))


def pendientes(store, *, mayores_a_s: float = 30, limite: int = 2000) -> dict:
    """{colección: [_id…]} de la bandeja con más de `mayores_a_s` segundos."""
    salida = {}
    for coleccion, llave, tipo in store.query(
            "SELECT collection, id, id_type FROM mongo._outbox WHERE at < now() - make_interval(secs => %s) "
            "ORDER BY seq LIMIT %s", (mayores_a_s, limite)):
        salida.setdefault(coleccion, []).append(codec.id_from_key(llave, tipo))
    return salida
