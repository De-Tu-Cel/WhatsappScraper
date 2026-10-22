"""Sombra de escrituras: antes de que Postgres mande, cada update se calcula también con el motor
(actualizar.py) y se compara contra lo que dejó Mongo (docs/MIGRACION_POSTGRES.md, «Postgres fuente de
verdad»). Mongo sigue siendo la fuente de verdad: esto solo mide. Se enciende con PGMIRROR_WRITE_SHADOW=1
y solo en colecciones en modo postgres (ahí el espejo copia antes de responder, así que el «después» de
Postgres es el de Mongo).

Resultado de cada comparación (contadores por colección en mongo._counters):
  escritura_ok            el motor dejó lo mismo que Mongo
  escritura_dif           distinto: queda en mongo._shadow_diffs como «escritura:<método>»
  escritura_no_soportada  el update usa algo que el motor no hace (seguiría yendo a Mongo)
  escritura_carrera       no se pudo saber qué documento tocó Mongo (otro proceso escribió a la vez)
  escritura_sin_candidatos el filtro no encontró ningún documento y Mongo no cambió nada: no hay qué
                          comparar (un lease que aún no vence, el de otro proceso…). No cuenta como ok.
"""
import os

from app.pgmirror import actualizar, codec


def activa() -> bool:
    return os.getenv("PGMIRROR_WRITE_SHADOW", "").strip().lower() in ("1", "true", "si", "sí", "on")


def es_update(update) -> bool:
    return isinstance(update, dict) and bool(update) and all(isinstance(k, str) and k.startswith("$") for k in update)


def _igual(a: dict, b: dict, *, sin_orden: bool = False) -> bool:
    def norm(v):
        if isinstance(v, dict):
            return {k: norm(v[k]) for k in (sorted(v) if sin_orden else v)}
        if isinstance(v, list):
            return [norm(x) for x in v]
        return v
    a, b = codec.decode_doc(codec.encode_doc(norm(a))), codec.decode_doc(codec.encode_doc(norm(b)))  # al ms, como Mongo
    return codec.doc_hash(a) == codec.doc_hash(b)


_FALTA = object()


def _en_ruta(doc, ruta):
    for parte in ruta.split("."):
        if not isinstance(doc, dict) or parte not in doc:
            return _FALTA
        doc = doc[parte]
    return doc


def _otro_escritor(update: dict, despues: dict) -> bool:
    """Justo después de esta escritura, cada campo que puso con $set vale eso y cada uno que quitó con
    $unset no está. Si en Mongo no es así, otro proceso lo cambió después (medido en prod, 2026-10-22:
    dos procesos guardando el saldo de DataForSEO con ms de diferencia; un $unset de migrating_since
    y otro proceso que lo volvió a poner 9 ms después). Eso es una carrera, no un error del motor."""
    for ruta, valor in (update.get("$set") or {}).items():
        actual = _en_ruta(despues, ruta)
        if actual is _FALTA or not _igual({"v": actual}, {"v": valor}):
            return True
    for ruta in (update.get("$unset") or {}):
        if _en_ruta(despues, ruta) is not _FALTA:
            return True
    return False


def comparar(metodo: str, filtro, update, antes: dict, despues: dict, *, upserted=None, modificados=None,
             objetivo=None) -> tuple[str, str]:
    """antes/despues: {llave del _id: documento} de Postgres justo antes de la escritura y justo después de
    copiarla. `objetivo`: la llave del documento que tocó Mongo cuando se sabe (find_one_and_update).
    Devuelve (resultado, detalle)."""
    try:
        if objetivo is not None:
            if objetivo not in antes or objetivo not in despues:
                return "escritura_carrera", "el documento ya no está"
            esperado = actualizar.aplicar(antes[objetivo], update)
            if _igual(esperado, despues[objetivo]):
                return "escritura_ok", ""
            return "escritura_dif", f"_id {objetivo}: mongo={despues[objetivo]!r} motor={esperado!r}"
        if upserted is not None:
            llave = codec.id_key(upserted)[0]
            esperado = actualizar.documento_de_upsert(filtro, update, upserted)
            # El orden de los campos que salen del filtro no es determinista ni en Mongo 7.
            if llave in despues and _igual(esperado, despues[llave], sin_orden=True):
                return "escritura_ok", ""
            return "escritura_dif", f"upsert {upserted!r}: mongo={despues.get(llave)!r} motor={esperado!r}"
        if not antes:
            # Ningún documento cumplía el filtro (en prod, 2026-10-22: los leases de envío y calentamiento
            # se intentan tomar cada 3 s y casi siempre siguen vigentes): nada que comparar.
            if not modificados:
                return "escritura_sin_candidatos", ""
            return "escritura_carrera", "Mongo tocó un documento que la consulta previa no vio"
        cambiaron = [k for k in antes if k in despues and not _igual(antes[k], despues[k])]
        if modificados is not None and modificados != len(cambiaron):
            # Mongo dice cuántos modificó: si cambiaron otros (o más), los cambió otro proceso a la vez
            # (2026-10-22: un $setOnInsert sin efecto mientras otro proceso renovaba el lease).
            return "escritura_carrera", f"Mongo modificó {modificados} y cambiaron {len(cambiaron)}"
        if metodo in ("update_one", "find_one_and_update"):
            if modificados == 0:
                # No-op ($set del mismo valor, $addToSet de uno que ya estaba…): el motor tampoco debe cambiarlo.
                if any(_igual(actualizar.aplicar(d, update), d) for d in antes.values()):
                    return "escritura_ok", ""
                return "escritura_dif", f"Mongo no cambió nada y el motor sí ({len(antes)} candidatos)"
            if len(cambiaron) != 1:
                return "escritura_carrera", f"{len(cambiaron)} documentos cambiaron"
            objetivos = cambiaron
        else:
            objetivos = [k for k in antes if k in despues]
        for k in objetivos:
            esperado = actualizar.aplicar(antes[k], update)
            if not _igual(esperado, despues[k]):
                if _otro_escritor(update, despues[k]):
                    return "escritura_carrera", f"_id {k}: otro proceso cambió lo que esta escritura acababa de poner"
                return "escritura_dif", f"_id {k}: mongo={despues[k]!r} motor={esperado!r}"
        return "escritura_ok", ""
    except actualizar.NoSoportado as exc:
        return "escritura_no_soportada", str(exc)
    except actualizar.ErrorDeMongo as exc:
        return "escritura_dif", f"el motor dio error y Mongo no: {exc}"
