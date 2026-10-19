"""Métricas extra del panel Desempeño: embudo, resultado de envíos,
estabilidad por sesión y tiempo de primera respuesta.

Todo sale de colecciones que ya existen (message_logs, delivery_receipts,
instance_health_logs) — nada se estima ni se inventa. Las funciones puras
(summarize_*, first_response_delays) reciben filas ya consultadas para poder
probarse sin Mongo; extended_metrics() es la única que toca la base.
"""
from datetime import datetime, timedelta, timezone
from statistics import median

# Estados de un outbound que el proveedor sí aceptó. "synced" = mensaje que
# el agente mandó desde el propio teléfono y se capturó después.
CONFIRMED_STATUSES = ("sent", "delivered", "read", "synced")
DELIVERED_STATUSES = ("delivered", "read")

# Un claim de delivery_receipts que sigue en "dispatching" más de esto ya no
# es un envío en curso: el proceso murió a medio envío y nadie sabe si salió.
STUCK_DISPATCH_AFTER = timedelta(minutes=10)

# Cortes del histograma de primera respuesta, en minutos (límite superior
# exclusivo; el último cubre todo lo que pasa de 24 h).
RESPONSE_BINS = (
    ("lt5m", 5),
    ("5_30m", 30),
    ("30m_2h", 120),
    ("2_8h", 480),
    ("8_24h", 1440),
    ("gt24h", None),
)


def summarize_send_outcomes(rows):
    """rows: [{"_id": {"i": instance, "s": status, "b": blocked_bool}, "n": int}]
    → totales por resultado + desglose por instancia. Un envío frenado por las
    reglas de contacto (recipient_blocked) no es una falla de WhatsApp, así que
    se cuenta aparte en vez de inflar "fallidos"."""
    totals = {"confirmed": 0, "delivered": 0, "failed": 0, "blocked": 0, "other": 0}
    by_instance = {}
    for row in rows:
        key = row.get("_id") or {}
        n = int(row.get("n") or 0)
        status = key.get("s")
        if status in CONFIRMED_STATUSES:
            bucket = "confirmed"
        elif status == "failed":
            bucket = "blocked" if key.get("b") else "failed"
        else:
            bucket = "other"
        totals[bucket] += n
        if status in DELIVERED_STATUSES:
            totals["delivered"] += n
        name = key.get("i")
        if name:
            inst = by_instance.setdefault(name, {"instance_name": name, "confirmed": 0, "failed": 0, "blocked": 0})
            if bucket in inst:
                inst[bucket] += n
    instances = sorted(by_instance.values(), key=lambda r: r["confirmed"] + r["failed"] + r["blocked"], reverse=True)
    return totals, instances


def first_response_delays(first_outbound, inbound_docs):
    """first_outbound: {company_id: datetime del primer envío confirmado}.
    inbound_docs: inbound ordenados por created_at ascendente.
    → [(sent_at, minutos)] usando la PRIMERA respuesta posterior a ese envío."""
    pending = dict(first_outbound)
    delays = []
    for doc in inbound_docs:
        cid = doc.get("company_id")
        sent_at = pending.get(cid)
        received_at = doc.get("created_at")
        if sent_at is None or received_at is None or received_at <= sent_at:
            continue
        delays.append((sent_at, (received_at - sent_at).total_seconds() / 60))
        del pending[cid]
        if not pending:
            break
    return delays


def _round_minutes(value):
    return None if value is None else round(value, 1)


def summarize_response_delays(delays, bucket_format):
    """Mediana general, histograma por rangos fijos y mediana por periodo
    (bucket del envío, mismo formato que la serie de mensajes)."""
    minutes = [m for _, m in delays]
    histogram = []
    lower = 0
    for key, upper in RESPONSE_BINS:
        count = sum(1 for m in minutes if m >= lower and (upper is None or m < upper))
        histogram.append({"key": key, "count": count})
        lower = upper if upper is not None else lower
    by_bucket = {}
    for sent_at, m in delays:
        by_bucket.setdefault(sent_at.strftime(bucket_format), []).append(m)
    timeseries = [
        {"bucket": bucket, "median_minutes": _round_minutes(median(values)), "count": len(values)}
        for bucket, values in sorted(by_bucket.items())
    ]
    return {
        "count": len(minutes),
        "median_minutes": _round_minutes(median(minutes)) if minutes else None,
        "histogram": histogram,
        "timeseries": timeseries,
    }


def summarize_disconnects(rows, instance_names, uptime):
    """rows: [{"_id": {"i": instance, "r": reason}, "n": int, "label": str}]
    → (estabilidad por instancia, causas agregadas)."""
    reasons = {}
    per_instance = {name: {} for name in instance_names}
    for row in rows:
        key = row.get("_id") or {}
        reason = key.get("r") or "unknown"
        n = int(row.get("n") or 0)
        entry = reasons.setdefault(reason, {"reason": reason, "label": row.get("label"), "count": 0})
        entry["count"] += n
        entry["label"] = entry["label"] or row.get("label")
        name = key.get("i")
        if name:
            per = per_instance.setdefault(name, {})
            per[reason] = per.get(reason, 0) + n
    stability = []
    for name, by_reason in per_instance.items():
        up = uptime.get(name) or {}
        stability.append({
            "instance_name": name,
            "uptime_pct": up.get("uptime_pct"),
            "disconnects": sum(by_reason.values()),
            "reasons": by_reason,
            "last_event": up.get("last_event"),
            "last_ts": up.get("last_ts"),
        })
    # Primero las que más se caen; las que no tienen ningún dato al final.
    stability.sort(key=lambda r: (-r["disconnects"], r["uptime_pct"] is None, r["uptime_pct"] or 0))
    return stability, sorted(reasons.values(), key=lambda r: r["count"], reverse=True)


def _response_delays_for(db, out_match, in_match):
    first_outbound = {
        r["_id"]: r["t"] for r in db.db.message_logs.aggregate([
            {"$match": {**out_match, "status": {"$in": list(CONFIRMED_STATUSES)}}},
            {"$group": {"_id": "$company_id", "t": {"$min": "$created_at"}}},
        ])
    }
    if not first_outbound:
        return []
    inbound = db.db.message_logs.find(
        {**in_match, "company_id": {"$in": list(first_outbound)}},
        {"_id": 0, "company_id": 1, "created_at": 1},
    ).sort("created_at", 1)
    return first_response_delays(first_outbound, inbound)


def extended_metrics(db, *, match, match_with_company, match_in, prev_match_with_company, prev_match_in,
                     contacted_ids, replied_ids, since, until, instance_names, uptime, bucket_format):
    """Bloques nuevos del endpoint /admin/instances/metrics.
    `match` = intentos (cualquier estado); `match_with_company`/`contacted_ids`
    = solo envíos confirmados (lo que la tarjeta llama "alcanzados")."""
    # ── Embudo (empresas distintas): intentadas → alcanzadas → respondieron → conversación ──
    attempted_ids = set(db.db.message_logs.distinct(
        "company_id", {**match, "company_id": {"$exists": True, "$ne": None}}))
    reached_ids = contacted_ids
    replied_reached = replied_ids & reached_ids
    conversation_ids = {
        r["_id"] for r in db.db.message_logs.aggregate([
            {"$match": match_in},
            {"$group": {"_id": "$company_id", "n": {"$sum": 1}}},
            {"$match": {"n": {"$gte": 2}}},
        ])
    }
    funnel = {
        "contacted": len(attempted_ids | reached_ids),
        "accepted": len(reached_ids),
        "replied": len(replied_reached),
        "conversation": len(conversation_ids & replied_reached),
    }

    # ── Resultado de envíos (mensajes) ──
    outcome_rows = list(db.db.message_logs.aggregate([
        {"$match": match},
        {"$group": {
            "_id": {"i": "$instance_name", "s": "$status", "b": {"$eq": ["$error", "recipient_blocked"]}},
            "n": {"$sum": 1},
        }},
    ]))
    totals, outcome_instances = summarize_send_outcomes(outcome_rows)
    # delivery_receipts no guarda la instancia: la entrega incierta solo se
    # puede dar como total global del periodo.
    stuck_before = min(until, datetime.utcnow() - STUCK_DISPATCH_AFTER)
    totals["uncertain"] = db.db.delivery_receipts.count_documents({
        "created_at": {"$gte": since.replace(tzinfo=timezone.utc), "$lt": until.replace(tzinfo=timezone.utc)},
        "$or": [
            {"status": "uncertain"},
            {"status": "dispatching", "created_at": {"$lt": stuck_before.replace(tzinfo=timezone.utc)}},
        ],
    })

    # ── Estabilidad por sesión ──
    disconnect_rows = list(db.db.instance_health_logs.aggregate([
        {"$match": {"event": "disconnected", "ts": {"$gte": since, "$lt": until}}},
        {"$sort": {"ts": 1}},
        {"$group": {"_id": {"i": "$instance_name", "r": "$reason"}, "n": {"$sum": 1}, "label": {"$last": "$reason_label"}}},
    ]))
    stability, disconnect_reasons = summarize_disconnects(disconnect_rows, instance_names, uptime)

    # ── Tiempo de primera respuesta ──
    first_response = summarize_response_delays(
        _response_delays_for(db, match_with_company, match_in), bucket_format)
    prev_delays = _response_delays_for(db, prev_match_with_company, prev_match_in)
    first_response["prev_median_minutes"] = (
        _round_minutes(median(m for _, m in prev_delays)) if prev_delays else None)

    return {
        "funnel": funnel,
        "send_outcomes": {**totals, "instances": outcome_instances},
        "stability": stability,
        "disconnect_reasons": disconnect_reasons,
        "first_response": first_response,
    }
