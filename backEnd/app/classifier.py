# classifier.py
"""Groq-based classifier for inbound WhatsApp responses."""
import json
import logging
import threading
import time
from datetime import datetime, timedelta

# Allow at most 2 concurrent Groq calls to stay within TPM limits
_GROQ_SEMAPHORE = threading.Semaphore(2)

from app.config import GROQ_API_KEY, DEEPSEEK_API_KEY
from app.database import MongoDBManager

log = logging.getLogger(__name__)

# ── Circuit breaker — all providers exhausted ─────────────────────────────────
# When both DeepSeek and Groq are out of quota, pause classification for
# _QUOTA_PAUSE_MINUTES to avoid hammering the APIs and spamming logs.
_QUOTA_PAUSE_MINUTES = 60
_quota_exhausted_until: float = 0.0  # epoch seconds

def all_quota_exhausted() -> bool:
    return time.time() < _quota_exhausted_until

def _set_quota_circuit_open():
    global _quota_exhausted_until
    _quota_exhausted_until = time.time() + _QUOTA_PAUSE_MINUTES * 60
    log.warning(
        "Circuit breaker abierto — todos los proveedores LLM sin cuota. "
        "Clasificación pausada por %d minutos.", _QUOTA_PAUSE_MINUTES
    )

def reset_quota_circuit():
    """Call this after adding credits or when quotas reset."""
    global _quota_exhausted_until
    _quota_exhausted_until = 0.0
    log.info("Circuit breaker de cuota LLM reiniciado manualmente.")


class GroqQuotaExceeded(Exception):
    """Raised when Groq daily token quota (TPD) is exhausted. Do not retry."""


class LLMQuotaExceeded(Exception):
    """Raised when the LLM provider quota is exhausted. Do not retry."""

_PROMPT_TEMPLATE = """\
Eres un auditor experto en calidad de atención comercial vía WhatsApp en Latinoamérica. \
Evalúas dos cosas independientes: (1) el origen de la respuesta y (2) la calidad del servicio entregado.

MENSAJE ENVIADO: {outbound_body}
RESPUESTA DEL PROSPECTO: {inbound_body}

══ PASO 1: ORIGEN DE LA RESPUESTA (elige UNO) ══

"humano" — persona real en tiempo real.
  Fuertes: typos, lenguaje coloquial, contracciones ("qué","sí","oye"), responde al tema, tono personal.
  Débiles: respuesta corta (humano ocupado), errores de puntuación.

"automatico" — plantilla fija sin lógica de conversación.
  Fuertes: folio/ticket (#00123), "en breve te atendemos", "mensaje generado automáticamente", horarios explícitos ("Lun-Vie 9-18h"), ignora completamente el contenido enviado.

"hibrido" — auto + oferta/transferencia explícita a humano.
  Fuertes: "¿Deseas hablar con un asesor?", "Te paso con un agente", menú con opción de persona real.
  Regla: evidencia de AMBAS partes (auto + transferencia).

"bot" — lógica propia, flujo guiado o IA conversacional.
  is_ai=false: opciones numeradas, pide datos paso a paso, nombre artificial ("Soy Sofía"), ignora pregunta.
  is_ai=true: lenguaje natural fluido, entiende el contexto, sin menús, español perfecto, tono overly helpful.

REGLA DE ORO: ante la duda → humano. Solo no-humano con evidencia CLARA.

══ PASO 2: CALIDAD DE SERVICIO (1-5 por dimensión) ══
Mide CÓMO atendieron al prospecto, independientemente de si hay interés de compra.
Escala: 1=inexistente/pésimo · 2=deficiente · 3=aceptable · 4=bueno · 5=excelente
Para automáticos/bots que ignoran la consulta: 1-2 en todas las dimensiones.

svc_prof: Profesionalismo — ortografía, tono apropiado, coherencia y claridad del mensaje
svc_comp: Completitud — ¿respondió lo que se preguntó o solicitó?
svc_empa: Empatía — calidez, personalización, reconoce y valida la necesidad del prospecto
svc_solu: Solución — ¿ofreció algo concreto? (precio, producto, alternativa, cita)
svc_next: Siguiente paso — ¿quedó claro qué sigue? (CTA explícito: llamada, reunión, link, precio)
svc_proact: Proactividad — ¿anticipó necesidades, hizo preguntas de calificación, ofreció info extra?

══ PASO 3: SEÑAL COMERCIAL (1-5) ══
¿Qué tan caliente quedó el lead? ¿Esta respuesta acerca o aleja una venta?

1 — Ruido total: "Ok","👍","Gracias", emoji, acuse de 1-2 palabras. Bots/automáticos usar 1-2.
2 — Cortesía vacía: reconoce contacto pero evita el tema. "Ahorita te marco", template de bienvenida.
3 — Apertura tibia: toca el tema sin compromiso. "Mándame info", "¿De qué se trata?".
4 — Señal real: preguntas específicas, contexto de situación, menciona necesidad o timing.
5 — Lead caliente: pide cotización, propone llamada/reunión, menciona presupuesto o urgencia.

IMPORTANTE: 80% son 1-2. Un 3 requiere evidencia específica. 4-5 son excepcionales.

══ PASO 4: DIAGNÓSTICO (máximo 15 palabras) ══
Hallazgo más importante: qué reveló sobre el servicio y/o la intención de compra.
✓ "Pidió precio urgente, pero respuesta tardó 3 horas sin disculpa ni solución"
✓ "Bot menú rígido, ignoró pregunta, solo presenta opciones numeradas"
✓ "Humano resolvió rápido y ofreció demo, excelente seguimiento"
✗ "Respuesta breve" / "Muestra interés" / "Sistema automático"

is_ai: true SOLO si category="bot" Y es IA conversacional (no menú rígido)
bot_quality: SOLO si category="bot": 1=menú básico · 3=flujo funcional · 5=IA avanzada
ai_confidence: 0.0-1.0 (certeza de IA, solo si is_ai=true)

Responde SOLO con JSON válido:
{{"category":"humano|automatico|hibrido|bot","is_ai":false,"ai_confidence":0.0,"svc_prof":3,"svc_comp":3,"svc_empa":3,"svc_solu":3,"svc_next":3,"svc_proact":3,"response_quality":1,"bot_quality":null,"notes":"diagnóstico"}}\
"""

_ERROR_RESULT = {
    "category": "humano",
    "is_ai": False,
    "ai_confidence": 0.0,
    "svc_prof": None,
    "svc_comp": None,
    "svc_empa": None,
    "svc_solu": None,
    "svc_next": None,
    "svc_proact": None,
    "response_quality": 3,
    "bot_quality": None,
    "notes": "Groq no configurado",
    "error": True,
}


def is_business_hours(dt: datetime) -> bool:
    """Returns True if dt falls within Monday–Friday 09:00–18:00."""
    return dt.weekday() < 5 and 9 <= dt.hour < 18


def _build_prompt(inbound_body: str, outbound_body: str, reaction_time_min: float = None) -> str:
    reaction_hint = ""
    if reaction_time_min is not None:
        secs = reaction_time_min * 60
        if secs < 10:
            reaction_hint = (
                f"\n🚨 SEÑAL CRÍTICA DE TIEMPO: respuesta en {secs:.0f} segundos — CERTEZA de bot/automatico. "
                "Un humano no puede leer y responder en menos de 10 segundos."
            )
        elif secs < 30:
            reaction_hint = (
                f"\n⚠️ SEÑAL FUERTE DE TIEMPO: respuesta en {secs:.0f} segundos — casi con certeza bot/automatico. "
                "Solo un sistema puede responder tan rápido."
            )
        elif secs < 120:
            reaction_hint = (
                f"\n⚠️ POSIBLE BOT: respuesta en {secs:.0f} segundos ({reaction_time_min:.1f} min) — "
                "tiempo corto, puede ser bot rápido o humano muy atento. Analizar contenido."
            )
        elif reaction_time_min < 10:
            reaction_hint = (
                f"\nℹ️ TIEMPO NORMAL: respuesta en {reaction_time_min:.0f} minutos — "
                "compatible con humano. Analizar contenido para confirmar."
            )
        elif reaction_time_min < 60:
            reaction_hint = (
                f"\nℹ️ TIEMPO HUMANO: respuesta en {reaction_time_min:.0f} minutos — "
                "muy probable que sea humano. Automáticos responden en segundos."
            )
        else:
            h = int(reaction_time_min // 60); mn = int(reaction_time_min % 60)
            time_str = f"{h}h {mn}m" if mn else f"{h}h"
            reaction_hint = (
                f"\nℹ️ RESPUESTA TARDÍA: {time_str} — puede ser humano fuera de horario "
                "o mensaje automático de bienvenida demorado."
            )
    return _PROMPT_TEMPLATE.format(
        outbound_body=outbound_body or "(sin texto)",
        inbound_body=inbound_body or "(sin texto)",
    ) + reaction_hint


_VALID_CATEGORIES = {"humano", "automatico", "hibrido", "bot"}

def _parse_llm_response(raw: str) -> dict:
    if raw.startswith("```"):
        raw = raw.split("```")[1].strip()
        if raw.startswith("json"):
            raw = raw[4:].strip()
    result = json.loads(raw)
    category = result.get("category", "humano")
    if category not in _VALID_CATEGORIES:
        category = "humano"
    is_ai = bool(result.get("is_ai", False)) if category == "bot" else False

    def _svc(key):
        v = result.get(key)
        if v is None:
            return None
        try:
            v = int(round(float(v)))
            return max(1, min(5, v))
        except (TypeError, ValueError):
            return None

    return {
        "category": category,
        "is_ai": is_ai,
        "ai_confidence": round(float(result.get("ai_confidence", 0.0)), 2) if is_ai else 0.0,
        "svc_prof":   _svc("svc_prof"),
        "svc_comp":   _svc("svc_comp"),
        "svc_empa":   _svc("svc_empa"),
        "svc_solu":   _svc("svc_solu"),
        "svc_next":   _svc("svc_next"),
        "svc_proact": _svc("svc_proact"),
        "response_quality": result.get("response_quality") or 2,
        "bot_quality": result.get("bot_quality"),
        "notes": result.get("notes", ""),
    }


def classify_response(inbound_body: str, outbound_body: str, reaction_time_min: float = None) -> dict:
    """Classify an inbound response using DeepSeek (primary) → Groq (fallback).
    Raises LLMQuotaExceeded only when ALL available providers are out of credits."""
    if not DEEPSEEK_API_KEY and not GROQ_API_KEY:
        return dict(_ERROR_RESULT)
    if all_quota_exhausted():
        raise LLMQuotaExceeded("Circuit breaker activo — todos los proveedores sin cuota, esperando reset.")

    prompt = _build_prompt(inbound_body, outbound_body, reaction_time_min)
    messages = [{"role": "user", "content": prompt}]

    deepseek_quota_hit = False

    # ── DeepSeek (primary) ────────────────────────────────────────────────────
    if DEEPSEEK_API_KEY:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url="https://api.deepseek.com")
            with _GROQ_SEMAPHORE:
                for _attempt in range(4):
                    try:
                        resp = client.chat.completions.create(
                            model="deepseek-chat",
                            messages=messages,
                            temperature=0,
                            max_tokens=280,
                        )
                        break
                    except Exception as _e:
                        _err_str = str(_e).lower()
                        _is_quota = "402" in str(_e) or "insufficient_balance" in _err_str
                        _is_429   = "429" in str(_e) or "rate_limit" in _err_str
                        if _is_quota:
                            log.warning("DeepSeek saldo insuficiente — intentando Groq como fallback")
                            deepseek_quota_hit = True
                            raise  # exit retry loop
                        if _is_429 and _attempt < 3:
                            _wait = 5 * (2 ** _attempt)
                            log.warning("DeepSeek 429 — reintentando en %ds (intento %d/4)", _wait, _attempt + 1)
                            time.sleep(_wait)
                        else:
                            raise
            if not deepseek_quota_hit:
                return _parse_llm_response(resp.choices[0].message.content.strip())
        except Exception as e:
            if not deepseek_quota_hit:
                import traceback
                log.error("DeepSeek classify_response failed: %s\n%s", e, traceback.format_exc())
                # Non-quota DeepSeek error: fall through to Groq

    # ── Groq (fallback) ───────────────────────────────────────────────────────
    if not GROQ_API_KEY:
        # No fallback available
        raise LLMQuotaExceeded("DeepSeek sin saldo y Groq no configurado")

    try:
        from groq import Groq
        client = Groq(api_key=GROQ_API_KEY)
        with _GROQ_SEMAPHORE:
            for _attempt in range(4):
                try:
                    resp = client.chat.completions.create(
                        model="llama-3.3-70b-versatile",
                        messages=messages,
                        temperature=0,
                        max_tokens=280,
                    )
                    break
                except Exception as _e:
                    _err_str = str(_e).lower()
                    _is_daily_quota = "tokens per day" in _err_str or ("tpd" in _err_str and "429" in _err_str)
                    _is_429 = "429" in str(_e) or "rate_limit" in _err_str
                    if _is_daily_quota:
                        log.warning("Groq cuota diaria agotada")
                        raise GroqQuotaExceeded(str(_e))
                    if _is_429 and _attempt < 3:
                        _wait = 5 * (2 ** _attempt)
                        log.warning("Groq 429 — reintentando en %ds", _wait)
                        time.sleep(_wait)
                    else:
                        raise
        return _parse_llm_response(resp.choices[0].message.content.strip())
    except GroqQuotaExceeded:
        raise LLMQuotaExceeded("DeepSeek sin saldo y Groq cuota agotada")
    except Exception as e:
        import traceback
        log.error("Groq classify_response failed: %s\n%s", e, traceback.format_exc())
        return {"category": "humano", "response_quality": 3, "bot_quality": None, "notes": "Error al clasificar", "error": True}


_AUTO_FOLLOWUP_MINUTES = 5   # wait up to 5 min for human after auto-response


def classify_and_save(log_id: str, company_id: str, inbound_body: str, received_at: datetime):
    """Background task: classify inbound message. For auto-responses, waits for a possible
    human follow-up message before finalising the classification."""
    try:
        from bson import ObjectId
        db = MongoDBManager()

        # Check if this message resolves a pending human-followup for the same company
        pending = db.db.message_logs.find_one({
            "company_id": company_id,
            "direction": "inbound",
            "analysis.pending_human_check": True,
            "analysis.followup_deadline": {"$gte": received_at},
        })
        if pending:
            # A human message arrived within the wait window — upgrade the prior auto analysis
            prior_id = str(pending["_id"])
            prior_outbound = db.get_last_outbound_for_company(
                company_id,
                before_dt=pending.get("created_at", received_at),
            )
            outbound_body = (prior_outbound or {}).get("message_body") or ""
            reaction_time_min = None
            if prior_outbound and prior_outbound.get("created_at"):
                delta = received_at - prior_outbound["created_at"]
                reaction_time_min = round(delta.total_seconds() / 60, 1)
            upgraded = classify_response(inbound_body, outbound_body, reaction_time_min)
            upgraded["reaction_time_min"] = reaction_time_min
            upgraded["business_hours"] = is_business_hours(received_at)
            upgraded["classified_at"] = datetime.now().isoformat()
            upgraded["pending_human_check"] = False
            upgraded["upgraded_from_auto"] = True
            db.save_message_analysis(prior_id, upgraded)
            # Also classify the current message normally (it will link to the same company)

        # Standard classification for this message
        inbound_doc = db.db.message_logs.find_one({"_id": ObjectId(log_id)}, {"from_number": 1, "number": 1})
        from_number = (inbound_doc or {}).get("from_number") or (inbound_doc or {}).get("number")

        last_outbound = db.get_last_outbound_for_company(
            company_id, before_dt=received_at, to_number=from_number
        )
        if not last_outbound:
            last_outbound = db.get_last_outbound_for_company(company_id, before_dt=received_at)

        outbound_body = ""
        reaction_time_min = None
        if last_outbound:
            outbound_body = last_outbound.get("message_body") or last_outbound.get("message_text") or ""
            last_sent_at = last_outbound.get("created_at")
            if last_sent_at and isinstance(last_sent_at, datetime):
                delta = received_at - last_sent_at
                minutes = round(delta.total_seconds() / 60, 1)
                reaction_time_min = minutes if minutes >= 0 else None

        business_hours = is_business_hours(received_at)
        analysis = classify_response(inbound_body, outbound_body, reaction_time_min)
        analysis["reaction_time_min"] = reaction_time_min
        analysis["business_hours"] = business_hours
        analysis["classified_at"] = datetime.now().isoformat()

        # If auto-response: mark as pending human-followup for the next 5 minutes
        if analysis.get("category") in ("automatico", "bot"):
            analysis["pending_human_check"] = True
            analysis["followup_deadline"] = received_at + timedelta(minutes=_AUTO_FOLLOWUP_MINUTES)
        else:
            analysis["pending_human_check"] = False

        db.save_message_analysis(log_id, analysis)
    except (GroqQuotaExceeded, LLMQuotaExceeded):
        _set_quota_circuit_open()
        log.warning("classify_and_save: todos los proveedores sin cuota para log_id=%s — marcado como quota_exceeded", log_id)
        try:
            from bson import ObjectId
            db.db.message_logs.update_one(
                {"_id": ObjectId(log_id)},
                {"$set": {"analysis_status": "quota_exceeded"}, "$unset": {"analysis": ""}},
            )
        except Exception:
            pass
    except Exception as _exc:
        import traceback
        log.error("classify_and_save failed for log_id=%s: %s\n%s", log_id, _exc, traceback.format_exc())
        try:
            from bson import ObjectId
            db.db.message_logs.update_one(
                {"_id": ObjectId(log_id)},
                {"$set": {"analysis_status": "error"}},
            )
        except Exception:
            pass


_NO_REPLY_WAIT_MINUTES = 30   # classify outbound with no reply after this window
_SWEEP_INTERVAL_SEC    = 300  # run sweep every 5 minutes


def _sweep_pending():
    """
    Runs every 5 minutes. Two jobs:

    1. Expire pending_human_check — auto/bot messages whose followup window
       passed without a human reply: mark pending_human_check=False so the UI
       stops waiting and shows the final auto/bot classification.

    2. Mark no-reply — outbound messages sent more than 30 minutes ago with
       no inbound response at all: save an analysis with category='sin_respuesta'.
    """
    try:
        db = MongoDBManager()
        now = datetime.now()

        # ── Job 1: expire stale pending_human_check ──────────────────────────
        db.db.message_logs.update_many(
            {
                "direction": "inbound",
                "analysis.pending_human_check": True,
                "analysis.followup_deadline": {"$lt": now},
            },
            {"$set": {"analysis.pending_human_check": False}},
        )

        # ── Job 2: no-reply outbound → mark sin_respuesta ────────────────────
        cutoff = now - timedelta(minutes=_NO_REPLY_WAIT_MINUTES)
        # Find outbound messages older than cutoff with no analysis yet
        outbounds = list(db.db.message_logs.find(
            {
                "direction": "outbound",
                "created_at": {"$lte": cutoff},
                "analysis": {"$exists": False},
            },
            {"_id": 1, "company_id": 1, "to_number": 1, "created_at": 1},
        ))

        for ob in outbounds:
            company_id = str(ob.get("company_id", ""))
            sent_at    = ob.get("created_at")
            # Check if ANY inbound arrived for this company after this outbound
            has_reply = db.db.message_logs.find_one({
                "company_id": company_id,
                "direction": "inbound",
                "created_at": {"$gt": sent_at},
            })
            if not has_reply:
                db.save_message_analysis(str(ob["_id"]), {
                    "category":         "sin_respuesta",
                    "svc_prof":         None,
                    "svc_comp":         None,
                    "svc_empa":         None,
                    "svc_solu":         None,
                    "svc_next":         None,
                    "svc_proact":       None,
                    "response_quality": 0,
                    "notes":            f"Sin respuesta tras {_NO_REPLY_WAIT_MINUTES} min",
                    "classified_at":    now.isoformat(),
                    "pending_human_check": False,
                })
        # ── Job 3: re-resolve inbound messages saved with company_id="unknown" ──
        unknowns = list(db.db.message_logs.find(
            {
                "direction": "inbound",
                "company_id": "unknown",
                "created_at": {"$gte": now - timedelta(hours=24)},
            },
            {"_id": 1, "from_number": 1, "message_body": 1},
        ))
        for msg in unknowns:
            from_number = msg.get("from_number", "")
            if not from_number:
                continue
            resolved = db.find_company_id_by_phone(from_number)
            if resolved:
                db.db.message_logs.update_one(
                    {"_id": msg["_id"]},
                    {"$set": {"company_id": resolved}},
                )
                body = msg.get("message_body", "")
                if body and GROQ_API_KEY:
                    import threading as _t
                    _t.Thread(
                        target=classify_and_save,
                        args=(str(msg["_id"]), resolved, body, now),
                        daemon=True,
                    ).start()

    except Exception:
        log.exception("_sweep_pending failed")


def start_classifier_background():
    """Launch the periodic sweep as a daemon thread. Call once at app startup."""
    def _loop():
        while True:
            time.sleep(_SWEEP_INTERVAL_SEC)
            _sweep_pending()

    t = threading.Thread(target=_loop, daemon=True, name="classifier-sweep")
    t.start()
    log.info("Classifier background sweep started (every %ds)", _SWEEP_INTERVAL_SEC)
