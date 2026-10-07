"""
Comparación de los tres clasificadores de conversaciones (real ask, 2026-10-05).

  timing   — solo tiempos: el diagrama "Flujo determinista" (T1 → 2do mensaje → T2 →
             análisis del mensaje #2: menú = Bot, conversacional = Agente IA). Sin IA.
  ia       — solo IA: un modelo (config.CLASSIFIER_MODEL) lee el contenido de la
             conversación, sin tiempos ni reglas fijas, y decide.
  hibrido  — Timing + IA: el clasificador de producción (classifier.classify_conversation
             + correcciones fijas). Su resultado es la categoría que ven la lista y el reporte.

Cada uno deja un log paso a paso de cómo llegó a su resultado ("trace"), para que se
pueda revisar el razonamiento de cada algoritmo. Lo último de cada empresa vive en
`classification_comparisons` (un doc por empresa — lo que muestra Análisis) y cada
corrida se agrega a `classification_logs` (historial).

Para comparar entre sí, cada resultado también se lleva a una categoría común
("common") — la de los resultados del diagrama de flujo.
"""
import json
import logging
import os
import re
from datetime import datetime, timedelta

log = logging.getLogger(__name__)

# Prefijo de colecciones — el backend local de pruebas usa "qa_" para no escribir en
# las colecciones reales (la base de datos es la misma que producción).
_PREFIX = os.getenv("CLASSIFICATION_COMPARE_PREFIX", "")
COMPARISONS = f"{_PREFIX}classification_comparisons"
LOGS = f"{_PREFIX}classification_logs"
# "0" en el backend local: Timing + IA se calcula igual pero no reemplaza la
# categoría guardada en message_logs.
SAVE_PROD = os.getenv("CLASSIFICATION_COMPARE_SAVE_PROD", "1") != "0"

METHODS = ("timing", "ia", "hibrido")
METHOD_LABELS = {"timing": "Timing", "ia": "IA", "hibrido": "Timing + IA"}
COMMON_LABELS = {
    "sin_respuesta": "Sin respuesta",
    "humano_o_desconectado": "Humano o canal desconectado",
    "humano": "Humano",
    "automatico_humano": "Automático + Humano",
    "automatico_sin_respuesta": "Automático + Sin respuesta",
    "bot": "Bot",
    "agente_ia": "Agente IA",
    "pendiente": "Pendiente",
}
_MX = timedelta(hours=-6)   # America/Mexico_City, UTC-6 todo el año


def _when(dt: datetime) -> str:
    return (dt + _MX).strftime("%d/%m %H:%M:%S")


def _secs(seconds: float) -> str:
    from app.classifier import _fmt_secs
    return _fmt_secs(seconds)


def _quote(text: str, n: int = 90) -> str:
    t = " ".join((text or "").split())
    return f"«{t[:n]}{'…' if len(t) > n else ''}»"


def to_common(category: str | None, is_ai: bool | None = None) -> str | None:
    """Categoría del clasificador de producción → categoría común de la comparación."""
    if category in ("bot", "menu"):
        return "agente_ia" if is_ai else "bot"
    if category in ("hibrido", "hibrido_bot", "hibrido_automatico", "automatico"):
        return "automatico_humano"
    if category == "automatico_sin_respuesta":
        return category
    if category in ("humano", "sin_respuesta"):
        return category
    return None


def _same(a: str | None, b: str | None) -> bool | None:
    """¿Coinciden dos resultados? None si alguno no tiene veredicto todavía. "Humano o
    canal desconectado" (Timing) cuenta como igual a Humano y a Sin respuesta: el
    diagrama junta ambos casos en ese resultado."""
    if not a or not b or "pendiente" in (a, b):
        return None
    if "humano_o_desconectado" in (a, b):
        return {a, b} <= {"humano_o_desconectado", "humano", "sin_respuesta"}
    return a == b


def agreement(timing: str | None, ia: str | None, hibrido: str | None) -> dict:
    pairs = {"timing_ia": _same(timing, ia), "timing_hibrido": _same(timing, hibrido),
             "ia_hibrido": _same(ia, hibrido)}
    vals = list(pairs.values())
    pairs["todos"] = None if None in vals else all(vals)
    return pairs


def _failed_sends(db, company_id: str, number: str | None = None) -> int:
    """Envíos que no llegaron. No entran a la plática (NOT_FAILED), pero el log tiene que
    decirlo: si no, parece que todavía no le escribimos. GAS 5 DE MAYO y aztecagas
    (2026-10-06), los dos intentos quedaron en failed."""
    try:
        rows = db.db.message_logs.find(
            {"company_id": company_id, "direction": "outbound", "status": "failed"},
            {"to_number": 1},
        )
    except Exception:
        return 0
    n = 0
    for row in rows:
        if number:
            digits = "".join(c for c in (row.get("to_number") or "") if c.isdigit())[-10:]
            if digits != number:
                continue
        n += 1
    return n


def _messages(db, company_id: str, limit: int = 0, number: str | None = None) -> list:
    """Plática de la empresa en orden, sin lo mandado a números que nunca contestaron
    (classifier.drop_unanswered_threads). Con `number`, solo la plática de ese número."""
    from app.classifier import NOT_FAILED, assign_thread_numbers, drop_unanswered_threads
    msgs = [m for m in db.db.message_logs.find(
        {"company_id": company_id, "direction": {"$in": ["inbound", "outbound"]}, **NOT_FAILED},
        {"direction": 1, "message_body": 1, "created_at": 1, "ai_generated": 1, "sent_by_name": 1,
         "to_number": 1, "from_number": 1},
        sort=[("created_at", 1)],
    ) if m.get("created_at")]
    if number:
        msgs = [m for m in assign_thread_numbers(msgs) if m["_num"] == number]
    else:
        msgs = drop_unanswered_threads(msgs)
    return msgs[:limit] if limit else msgs


def _result(method: str, common: str, trace: list, **extra) -> dict:
    trace.append({"paso": "Resultado", "detalle": COMMON_LABELS[common]})
    return {"method": method, "common": common, "label": COMMON_LABELS[common], "trace": trace, **extra}


# ── 1. Timing: el diagrama de flujo, paso por paso ─────────────────────────────
def run_timing(db, company_id: str, settings: dict | None = None, now: datetime | None = None,
               number: str | None = None) -> dict:
    from app.classifier import (
        _VIRTUAL_ASSISTANT_RE, _is_choice_menu, _is_ignorable_body, _looks_like_menu,
    )

    def _opening_is_bot(body: str) -> bool:
        # Taboo y Rivera Gas (2026-10-06): el menú llegó a los 11 s, más que T1, y no hubo
        # segundo mensaje. Compugadget: el menú tardó 24 min. El Chopo: el segundo mensaje
        # era un menú a los 7 s. Eso es un bot, no un humano ni Automático + Humano.
        text = body or ""
        return bool(_looks_like_menu(text) or _is_choice_menu(text) or _VIRTUAL_ASSISTANT_RE.search(text))
    s = settings or db.get_classifier_settings()
    t1_max, t2_max = s["t1_threshold_seconds"], s["t2_threshold_seconds"]
    wait = s["probe_wait_hours"] * 3600
    wait_label = f"{s['probe_wait_hours']:g} h"
    now = now or datetime.utcnow()
    msgs = _messages(db, company_id, number=number)
    trace = []
    # Las condiciones del diagrama, en orden: qué se midió, contra qué límite y cómo salió
    # ("si" / "no" / "pendiente"); las que no se alcanzaron quedan "no_evaluada". La que
    # decidió el resultado lleva "lleva_a". Es la tabla que muestra el log de Timing.
    checks = [
        {"key": "resp1", "cond": "¿Respondió al primer mensaje?", "limite": f"hasta {wait_label}"},
        {"key": "t1", "cond": "T1: tardanza de su primera respuesta", "limite": f"máx. {t1_max} s"},
        {"key": "envio2", "cond": "¿Se mandó el segundo mensaje?", "limite": "—"},
        {"key": "resp2", "cond": "¿Respondió al segundo mensaje?", "limite": f"hasta {wait_label}"},
        {"key": "t2", "cond": "T2: tardanza de su segunda respuesta", "limite": f"máx. {t2_max} s"},
        {"key": "menu", "cond": "¿El mensaje #2 trae menú?", "limite": "Sí = Bot · No = Agente IA"},
    ]
    for c in checks:
        c.update(medido=None, estado="no_evaluada")
    last = {"key": None}

    def check(key, estado, medido=None):
        next(c for c in checks if c["key"] == key).update(estado=estado, medido=medido)
        last["key"] = key

    def step(paso, detalle, respuesta=None):
        trace.append({"paso": paso, "detalle": detalle, **({"respuesta": respuesta} if respuesta else {})})

    inputs = {"umbral_t1_s": t1_max, "umbral_t2_s": t2_max, "espera_h": s["probe_wait_hours"],
              "t1_s": None, "t2_s": None}

    def done(common):
        if last["key"]:
            next(c for c in checks if c["key"] == last["key"])["lleva_a"] = COMMON_LABELS[common]
        return _result("timing", common, trace, inputs=inputs, checks=checks)

    outs = [m for m in msgs if m["direction"] == "outbound"]
    if not outs:
        # Sin esta fila la tabla queda toda en gris y el resultado Pendiente no tiene flecha.
        checks.insert(0, {
            "key": "envio1", "cond": "¿Llegó nuestro primer mensaje?", "limite": "—",
            "medido": None, "estado": "no_evaluada",
        })
        if _failed_sends(db, company_id, number):
            check("envio1", "no", "no llegó")
            step("Enviar primer mensaje",
                 "Se intentó escribir, pero el envío falló y el mensaje no llegó. No hay conversación que medir.")
        else:
            check("envio1", "pendiente", "no se ha mandado")
            step("Enviar primer mensaje", "Todavía no le escribimos a esta empresa.")
        return done("pendiente")
    first_out = outs[0]
    step("Enviar primer mensaje", f"{_when(first_out['created_at'])} — {_quote(first_out.get('message_body'))}")
    # Mazda Santa Anita (2026-10-06): el asistente digital contestó a los 9 s en un número
    # y "no estamos interesados" llegó media hora después en otro. El diagrama los lee juntos.
    nums = []
    for m in msgs:
        n = m.get("_num")
        if n and n not in nums:
            nums.append(n)
    if len(nums) > 1:
        step("Varios números",
             "Hay mensajes de " + ", ".join(nums) + ". Este diagrama los lee juntos, por hora: "
             "la primera respuesta que llega es la que decide, aunque sea de otro número. "
             "Cada número por separado se clasifica en su propia fila.")
    step("Activar temporizador T1", f"Espera hasta {wait_label} a que el negocio responda.")
    # Servi-Gas (2026-10-06): "Buenas tardes" llegó 21 min antes. Solo IA lo lee y dice Humano;
    # este diagrama no lo cuenta, y el log tiene que decir por qué.
    early = [m for m in msgs if m["direction"] == "inbound" and m["created_at"] < first_out["created_at"]
             and not _is_ignorable_body(m.get("message_body"))]
    if early:
        shown = early[-1]
        step("Llegó antes de que escribiéramos",
             f"{_when(shown['created_at'])} — {_quote(shown.get('message_body'))}. "
             "No es una contestación: ya estaba en el chat cuando mandamos el primer mensaje.")

    ignored = [m for m in msgs if m["direction"] == "inbound" and m["created_at"] > first_out["created_at"]
               and _is_ignorable_body(m.get("message_body"))]
    if ignored:
        step("Mensajes que no cuentan",
             f"Se ignoraron {len(ignored)} mensajes vacíos o ilegibles: no son una contestación.")

    def _answered_by(inn):
        prev = None
        for o in outs:
            if o["created_at"] < inn["created_at"]:
                prev = o
            else:
                break
        return prev

    # Un vacío a los 2 s no es T1 (Stellantis, 2026-10-06: el saludo real de Clarissa llegó a
    # los 42 s). Si el primer mensaje no tuvo respuesta dentro de la espera y un reintento sí,
    # se mide ese (Laboratorio del Chopo: al "Hola" no contestaron; al del día siguiente, en 6 s).
    exchange = late = None
    for inn in msgs:
        if inn["direction"] != "inbound" or inn["created_at"] <= first_out["created_at"]:
            continue
        if _is_ignorable_body(inn.get("message_body")):
            continue
        src = _answered_by(inn)
        if not src:
            continue
        gap = (inn["created_at"] - src["created_at"]).total_seconds()
        if gap <= wait:
            exchange = (src, inn, gap, src is not first_out)
            break
        if late is None:
            late = (src, inn, gap)

    q1 = f"¿El negocio respondió? (hasta {wait_label})"
    if not exchange:
        if late:
            inputs["t1_s"] = round(late[2], 1)
            check("resp1", "no", _secs(late[2]))
            step(q1, f"Su primera respuesta llegó {_secs(late[2])} después: más de {wait_label}.", "no")
            return done("humano_o_desconectado")
        if now - outs[-1]["created_at"] < timedelta(seconds=wait):
            check("resp1", "pendiente", "todavía no")
            step(q1, "Todavía no contesta y la hora de espera no ha terminado.", "pendiente")
            return done("pendiente")
        check("resp1", "no", "no contestó")
        step(q1, "No contestó.", "no")
        return done("humano_o_desconectado")

    measured_out, first_in, t1, used_retry = exchange
    inputs["t1_s"] = round(t1, 1)
    if used_retry:
        step("Se mide la respuesta al reintento",
             f"Al primer mensaje no contestaron dentro de {wait_label}. "
             f"Al mensaje del {_when(measured_out['created_at'])} contestaron en {_secs(t1)}.")
    check("resp1", "si", _secs(t1))
    step(q1, f"Contestó a los {_secs(t1)} ({_when(first_in['created_at'])}): {_quote(first_in.get('message_body'))}", "si")
    if _opening_is_bot(first_in.get("message_body") or ""):
        check("t1", "no" if t1 > t1_max else "si", _secs(t1))
        # Compugadget México (2026-10-06): el menú tardó 23 min 48 s. La flecha "→ Bot"
        # quedaba en la fila de T1 y se leía como "contestó tarde, entonces es bot".
        # T1 solo dice si fue rápido. Lo que decide es el texto.
        checks.insert(2, {
            "key": "menu1", "cond": "¿La primera respuesta es un menú?",
            "limite": "Sí = Bot, aunque tarde", "medido": None, "estado": "no_evaluada",
        })
        check("menu1", "si", "trae menú")
        step("¿La primera respuesta es un menú o un asistente virtual?",
             f"Llegó a los {_secs(t1)} y el texto ya es un menú o se presenta como asistente virtual → Bot.", "si")
        return done("bot")
    if t1 > t1_max:
        check("t1", "no", _secs(t1))
        step(f"¿T1 ≤ {t1_max} s?", f"{_secs(t1)} es más que el máximo de {t1_max} s: según el diagrama, contestó "
                                   "una persona → Humano.", "no")
        return done("humano")
    check("t1", "si", _secs(t1))
    step(f"¿T1 ≤ {t1_max} s?", f"{_secs(t1)} está dentro del máximo de {t1_max} s: puede ser una respuesta automática, "
                               "un bot o un agente. Sigue al segundo mensaje.", "si")

    second_out = next((m for m in msgs if m["direction"] == "outbound" and m["created_at"] > first_in["created_at"]), None)
    if not second_out:
        check("envio2", "pendiente", "no se ha mandado")
        step("Enviar segundo mensaje de seguimiento", "Todavía no se manda, así que no se puede medir T2.", "pendiente")
        return done("pendiente")
    who = "Chat IA" if second_out.get("ai_generated") else (second_out.get("sent_by_name") or "manual")
    check("envio2", "si", (second_out["created_at"] + _MX).strftime("%H:%M"))  # la fecha completa va en el paso
    step("Enviar segundo mensaje de seguimiento",
         f"{_when(second_out['created_at'])} ({who}) — {_quote(second_out.get('message_body'))}")
    step("Activar temporizador T2", f"Espera hasta {wait_label} a que responda el segundo mensaje.")

    q2 = f"¿Respondió al segundo mensaje? (hasta {wait_label})"
    second_in = next((m for m in msgs if m["direction"] == "inbound" and m["created_at"] > second_out["created_at"]
                      and not _is_ignorable_body(m.get("message_body"))), None)
    if not second_in:
        if now - second_out["created_at"] < timedelta(seconds=wait):
            check("resp2", "pendiente", "todavía no")
            step(q2, "Todavía no contesta y la hora de espera no ha terminado.", "pendiente")
            return done("pendiente")
        check("resp2", "no", "no contestó")
        step(q2, "Nadie contestó: lo rápido fue una respuesta automática → Automático + Sin respuesta.", "no")
        return done("automatico_sin_respuesta")
    t2 = (second_in["created_at"] - second_out["created_at"]).total_seconds()
    inputs["t2_s"] = round(t2, 1)
    if t2 > wait:
        check("resp2", "no", _secs(t2))
        step(q2, f"Contestó {_secs(t2)} después: más de {wait_label} → Automático + Sin respuesta.", "no")
        return done("automatico_sin_respuesta")
    check("resp2", "si", _secs(t2))
    step(q2, f"Contestó a los {_secs(t2)} ({_when(second_in['created_at'])}): {_quote(second_in.get('message_body'))}", "si")
    opening = _opening_is_bot(second_in.get("message_body") or "")
    if t2 > t2_max and not opening:
        check("t2", "no", _secs(t2))
        step(f"¿T2 ≤ {t2_max} s?", f"{_secs(t2)} es más que el máximo de {t2_max} s: el primero fue automático y el "
                                   "segundo lo contestó una persona → Automático + Humano.", "no")
        return done("automatico_humano")
    if t2 > t2_max:
        check("t2", "no", _secs(t2))
        check("menu", "si", "trae menú")
        step("¿El mensaje #2 trae menú?",
             f"Tardó {_secs(t2)}, más que {t2_max} s, pero el texto es un menú o un asistente virtual → Bot.", "si")
        return done("bot")
    check("t2", "si", _secs(t2))
    step(f"¿T2 ≤ {t2_max} s?", f"{_secs(t2)} está dentro del máximo de {t2_max} s: volvió a contestar al instante, "
                               "es un Bot o un Agente IA.", "si")
    if opening:
        check("menu", "si", "trae menú")
        step("¿El mensaje #2 trae menú?", "Trae un menú de opciones → Bot.", "si")
        return done("bot")
    check("menu", "no", "conversacional")
    step("¿El mensaje #2 trae menú?", "No trae menú: usa lenguaje conversacional → Agente IA.", "no")
    return done("agente_ia")


# ── 2. Solo IA: el modelo lee el contenido y decide ────────────────────────────
_AI_ONLY_PROMPT = """\
Eres un analista que revisa conversaciones de WhatsApp entre un cliente (nosotros) y un negocio en México.
Decide QUIÉN o QUÉ contestó del lado del negocio, leyendo SOLO el contenido de los mensajes. No tienes
horarios ni tiempos de respuesta: no los supongas.

Elige UNA categoría:
- "sin_respuesta": el negocio no mandó ningún mensaje.
- "humano": una persona escribe todas las respuestas del negocio.
- "automatico_humano": hay un mensaje automático (bienvenida de WhatsApp Business, plantilla, aviso de
  horario, menú inicial) y además escribe una persona.
- "automatico_sin_respuesta": el negocio solo mandó un mensaje automático (bienvenida, plantilla, aviso
  de horario o de ausencia) y nada más: nadie contestó después.
- "bot": todo es automático con un flujo fijo que sí sigue la plática: menús de opciones, botones,
  plantillas, textos repetidos; no entiende texto libre.
- "agente_ia": una inteligencia artificial conversacional: entiende texto libre y responde a lo que se le
  pregunta con frases naturales, sin que se vea una persona detrás (suele presentarse con un nombre,
  contestar con listas y resúmenes, repetir confirmaciones y no dejar terminar la plática).

Conversación — [Nosotros] = lo que mandamos, [Negocio] = lo que respondieron:
{thread}

Responde SOLO con JSON, sin texto alrededor:
{{"categoria": "...", "pasos": ["...", "..."], "evidencia": ["...", "..."], "confianza": 0.0}}
- "pasos": de 2 a 5 frases cortas en español que expliquen cómo llegaste a la conclusión.
- "evidencia": hasta 3 frases copiadas tal cual de los mensajes del negocio que lo demuestran.
- "confianza": de 0 a 1.
"""
_AI_CATEGORIES = ("sin_respuesta", "humano", "automatico_humano", "automatico_sin_respuesta", "bot", "agente_ia")


def run_ai_only(db, company_id: str, model: str | None = None, number: str | None = None) -> dict:
    from app.classifier import NON_TEXT_PLACEHOLDERS, _looks_like_binary_blob
    from app.config import CLASSIFIER_MODEL
    model = model or CLASSIFIER_MODEL
    msgs = _messages(db, company_id, limit=40, number=number)
    trace = []
    n_in = sum(1 for m in msgs if m["direction"] == "inbound")
    trace.append({"paso": "Arma la conversación para la IA",
                  "detalle": f"{len(msgs)} mensajes en orden — {len(msgs) - n_in} nuestros y {n_in} del negocio — "
                             "solo el texto, sin horas ni tiempos de respuesta."})
    if not n_in:
        trace.append({"paso": "Sin consultar al modelo", "detalle": "El negocio no ha mandado ningún mensaje."})
        return _result("ia", "sin_respuesta", trace, model=None)

    lines, hilo = [], []
    for m in msgs:
        body = (m.get("message_body") or "").strip()
        if not body and m["direction"] == "outbound":
            continue
        who = "Nosotros" if m["direction"] == "outbound" else "Negocio"
        # Una respuesta vacía (foto, audio o archivo sin descripción) sigue siendo una
        # respuesta — caso real: OH EXPRESS, sus dos mensajes llegaron sin texto.
        if not body or body in NON_TEXT_PLACEHOLDERS:
            body = "(mensaje sin texto: imagen, audio, sticker, archivo o ubicación)"
        elif "BEGIN:VCARD" in body.upper():
            body = "(compartió un contacto de WhatsApp)"
        elif _looks_like_binary_blob(body):
            body = "(mandó un archivo, sin texto legible)"
        elif len(body) > 800:
            body = body[:800] + "…"
        lines.append(f"[{who}]: {body}")
        hilo.append({"de": who, "t": "", "texto": body if len(body) <= 300 else body[:300] + "…"})
    trace.append({"paso": "Lo que recibió la IA", "detalle": "La conversación tal cual se la pasamos, solo el texto.",
                  "hilo": hilo})
    prompt = _AI_ONLY_PROMPT.format(thread="\n".join(lines).replace("{", "(").replace("}", ")"))
    try:
        from app.llm import PRIORITY_BATCH, call_llm
        raw = call_llm([{"role": "user", "content": prompt}], max_tokens=500, temperature=0,
                       priority=PRIORITY_BATCH, model=model)
    except Exception as e:
        trace.append({"paso": f"Consulta al modelo ({model})", "detalle": f"Falló: {e}"})
        return {"method": "ia", "common": None, "label": "Error", "trace": trace, "model": model, "error": str(e)}
    try:
        data = json.loads(re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip())
    except Exception:
        # Respuesta cortada (límite de tokens): se rescata al menos la categoría.
        m = re.search(r'"categoria"\s*:\s*"(\w+)"', raw)
        data = {"categoria": m.group(1)} if m else {}
    category = data.get("categoria")
    trace.append({"paso": f"La IA ({model}) decide", "detalle": "Le pide elegir una categoría y explicar paso a paso por qué."})
    for i, p in enumerate((data.get("pasos") or [])[:5], 1):
        trace.append({"paso": f"Razonamiento {i}", "detalle": str(p)})
    evid = [str(e) for e in (data.get("evidencia") or [])[:3]]
    if evid:
        trace.append({"paso": "Evidencia que cita", "detalle": " · ".join(f"«{e}»" for e in evid)})
    if category not in _AI_CATEGORIES:
        trace.append({"paso": "Respuesta inválida", "detalle": f"El modelo no devolvió una categoría válida: {raw[:200]}"})
        return {"method": "ia", "common": None, "label": "Error", "trace": trace, "model": model, "error": "respuesta inválida"}
    try:
        conf = max(0.0, min(1.0, float(data.get("confianza"))))
    except (TypeError, ValueError):
        conf = None
    return _result("ia", category, trace, model=model, confidence=conf)


# ── 3. Timing + IA (producción) y guardado de la comparación ───────────────────
def _hybrid_result(analysis: dict, trace: list) -> dict:
    from app.classifier import verdict_label
    from app.config import CLASSIFIER_MODEL
    category, is_ai = analysis.get("category"), bool(analysis.get("is_ai"))
    return {"method": "hibrido", "category": category, "is_ai": is_ai, "common": to_common(category, is_ai),
            "label": verdict_label(category, is_ai), "notes": analysis.get("notes") or "",
            "scores": {k: analysis[k] for k in _SCORE_FIELDS if analysis.get(k) is not None},
            "model": CLASSIFIER_MODEL, "trace": trace, "error": bool(analysis.get("error"))}


# Calificaciones de servicio del análisis de Timing + IA: viajan con la comparación para que el
# reporte las tome de la misma corrida que la categoría (ver report_verdict).
_SCORE_FIELDS = ("svc_prof", "svc_comp", "svc_empa", "svc_solu", "svc_next", "svc_proact", "response_quality")


def report_verdict(db, company_id: str, number: str | None = None) -> dict | None:
    """La clasificación de Timing + IA que muestra Análisis — la de la última comparación de la
    empresa, o la de uno de sus números si el reporte es de ese número — con su diagnóstico y sus
    calificaciones. El reporte la pone encima del análisis guardado en el mensaje: ese lo elige
    get_analytics por el mensaje más reciente, no por la clasificación más reciente, y cuando dos
    corren casi juntas puede quedarse con la vieja; además no tiene la clasificación de cada número.
    Nissan Autocom La Capilla (2026-10-06): Análisis decía Agente IA y el reporte, Bot + Humano.
    None si no hay comparación o si falló: el reporte se queda con el análisis guardado."""
    doc = db.db[COMPARISONS].find_one({"company_id": company_id}, {"hibrido": 1, "numbers": 1})
    if not doc:
        return None
    hybrid = doc.get("hibrido")
    if number:
        n10 = "".join(filter(str.isdigit, number))[-10:]
        entry = next((e for e in doc.get("numbers") or [] if e.get("number") == n10), None)
        if entry:
            hybrid = entry.get("hibrido")
    if not hybrid or hybrid.get("error") or not hybrid.get("category"):
        return None
    out = {"category": hybrid["category"], "is_ai": bool(hybrid.get("is_ai")), **(hybrid.get("scores") or {})}
    if hybrid.get("notes"):
        out["notes"] = hybrid["notes"]
    return out


def save_comparison(db, company_id: str, company: dict | None, hybrid: dict, hybrid_trace: list,
                    timing: dict | None = None, ia: dict | None = None) -> dict:
    """Corre Timing y solo IA (si no vienen), junta el resultado de Timing + IA y guarda
    la comparación de los tres con sus logs."""
    now = datetime.utcnow()
    timing = timing or run_timing(db, company_id)
    ia = ia or run_ai_only(db, company_id)
    results = {"timing": timing, "ia": ia, "hibrido": _hybrid_result(hybrid, hybrid_trace)}
    for r in results.values():
        r["ran_at"] = now
    doc = {
        "company_id": company_id,
        "company_name": (company or {}).get("name", ""),
        **results,
        "agreement": agreement(timing.get("common"), ia.get("common"), results["hibrido"]["common"]),
        "replied": bool(db.db.message_logs.find_one({"company_id": company_id, "direction": "inbound"}, {"_id": 1})),
        "numbers": _per_number(db, company_id, company, results, now),
        "updated_at": now,
    }
    db.db[COMPARISONS].update_one({"company_id": company_id}, {"$set": doc}, upsert=True)
    db.db[LOGS].insert_one(dict(doc))
    return doc


def _contacted_numbers(db, company_id: str) -> list:
    """Últimos 10 dígitos de cada número de la empresa al que le escribimos (sin los envíos que
    fallaron: a ese número no le llegó nada)."""
    from app.classifier import NOT_FAILED
    nums = set()
    for n in db.db.message_logs.distinct("to_number", {"company_id": company_id, "direction": "outbound", **NOT_FAILED}):
        d = "".join(filter(str.isdigit, n or ""))[-10:]
        if len(d) == 10:
            nums.add(d)
    return sorted(nums)


def _per_number(db, company_id: str, company: dict | None, company_results: dict, now: datetime) -> list:
    """Empresas con varios números: los tres clasificadores para la plática de cada número
    (el desplegable de Análisis). Solo gasta IA en los números que respondieron, y si
    respondió uno solo, su plática es la de la empresa: reusa esos resultados de IA."""
    from app.classifier import _apply_last_message_corrections, _trace, classify_conversation, verdict_label
    numbers = _contacted_numbers(db, company_id)
    if len(numbers) < 2:
        return []
    threads = {n: _messages(db, company_id, number=n) for n in numbers}
    replied = [n for n in numbers if any(m["direction"] == "inbound" for m in threads[n])]
    out = []
    for num in numbers:
        timing = run_timing(db, company_id, number=num)
        if num not in replied:
            ia = _result("ia", "sin_respuesta", [{"paso": "Sin consultar al modelo",
                                                  "detalle": "Este número no ha mandado ningún mensaje."}], model=None)
            trace = [{"paso": "Sin consultar al modelo", "detalle": "Este número no ha mandado ningún mensaje."}]
            hybrid = _hybrid_result({"category": "sin_respuesta", "is_ai": False}, trace + [{"paso": "Resultado", "detalle": "Sin respuesta"}])
        elif len(replied) == 1:
            ia, hybrid = company_results["ia"], company_results["hibrido"]
        else:
            ia = run_ai_only(db, company_id, number=num)
            trace = []
            analysis = classify_conversation(company_id, (company or {}).get("name", ""),
                                             (company or {}).get("industry", ""), trace=trace, messages=threads[num])
            last = next((m for m in reversed(threads[num]) if m["direction"] == "inbound"), {})
            analysis = _apply_last_message_corrections(analysis, last.get("message_body") or "", trace)
            _trace(trace, "Resultado", verdict_label(analysis.get("category"), analysis.get("is_ai")))
            hybrid = _hybrid_result(analysis, trace)
        entry = {"number": num, "timing": timing, "ia": dict(ia), "hibrido": dict(hybrid), "replied": num in replied}
        for m in METHODS:
            entry[m]["ran_at"] = now
        entry["agreement"] = agreement(timing.get("common"), ia.get("common"), hybrid.get("common"))
        out.append(entry)
    return out


def run_comparison(company_id: str, save_prod: bool | None = None) -> dict:
    """Corre los tres clasificadores para una empresa ahora mismo y guarda la comparación.
    Con save_prod, el resultado de Timing + IA reemplaza la categoría de la conversación
    (es el mismo clasificador de producción)."""
    from bson import ObjectId
    from app.classifier import (_apply_last_message_corrections, _trace, classify_conversation,
                                classify_conversation_and_save, verdict_label)
    from app.database import MongoDBManager
    save_prod = SAVE_PROD if save_prod is None else save_prod
    db = MongoDBManager()
    try:
        company = db.db.companies.find_one({"_id": ObjectId(company_id)}) or {}
    except Exception:
        company = {}
    last_in = db.db.message_logs.find_one({"company_id": company_id, "direction": "inbound"},
                                          {"message_body": 1}, sort=[("created_at", -1)])
    trace = []
    if not last_in:
        _trace(trace, "Sin consultar al modelo", "El negocio no ha mandado ningún mensaje.")
        _trace(trace, "Resultado", "Sin respuesta")
        hybrid = {"category": "sin_respuesta", "is_ai": False, "notes": "El negocio no ha respondido."}
    elif save_prod:
        hybrid = classify_conversation_and_save(company_id, str(last_in["_id"]), force=True,
                                                trace=trace, compare=False) or {"category": None, "error": True}
    else:
        hybrid = classify_conversation(company_id, company.get("name", ""), company.get("industry", ""), trace=trace)
        hybrid = _apply_last_message_corrections(hybrid, last_in.get("message_body") or "", trace)
        _trace(trace, "Resultado", verdict_label(hybrid.get("category"), hybrid.get("is_ai")))
    return save_comparison(db, company_id, company, hybrid=hybrid, hybrid_trace=trace)


# ── Lectura para Análisis ───────────────────────────────────────────────────────
_LIST_PROJECTION = {f"{m}.trace": 0 for m in METHODS} | {f"numbers.{m}.trace": 0 for m in METHODS} | {"_id": 0}


def comparisons_for(db, company_ids: list) -> dict:
    """{company_id: comparación sin los logs} — para las filas de Análisis."""
    if not company_ids:
        return {}
    return {d["company_id"]: d for d in db.db[COMPARISONS].find({"company_id": {"$in": list(company_ids)}},
                                                                _LIST_PROJECTION)}


def get_comparison(db, company_id: str) -> dict | None:
    return db.db[COMPARISONS].find_one({"company_id": company_id}, {"_id": 0})


def _replied(entry: dict) -> bool:
    if "replied" in entry:
        return bool(entry["replied"])
    return not ((entry.get("ia") or {}).get("common") == "sin_respuesta"
                and (entry.get("hibrido") or {}).get("common") == "sin_respuesta")


def summary(db) -> dict:
    """Coincidencia y reparto de los tres sobre las conversaciones CON respuesta — en
    empresas con varios números, cada número que contestó es una conversación. Las que
    nunca contestaron coinciden siempre ("sin respuesta") e inflarían el porcentaje."""
    docs = []
    for d in db.db[COMPARISONS].find({}, _LIST_PROJECTION):
        docs += [n for n in d["numbers"] if _replied(n)] if d.get("numbers") else ([d] if _replied(d) else [])
    out = {"total": len(docs), "coincidencia": {}, "por_metodo": {m: {} for m in METHODS}}
    for key in ("todos", "timing_ia", "timing_hibrido", "ia_hibrido"):
        vals = [d.get("agreement", {}).get(key) for d in docs]
        decided = [v for v in vals if v is not None]
        out["coincidencia"][key] = {"si": sum(decided), "de": len(decided)}
    for d in docs:
        for m in METHODS:
            c = (d.get(m) or {}).get("common") or "error"
            out["por_metodo"][m][c] = out["por_metodo"][m].get(c, 0) + 1
    return out
