# report_generator.py
import base64
import io
import os
from datetime import datetime

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, Color
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    Image, PageBreak, Flowable, HRFlowable,
)
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT

W, H = A4
LM = 20 * mm
RM = 20 * mm
TM = 22 * mm
BM = 22 * mm
PW = W - LM - RM   # usable page width ≈ 555 pt

C = {
    "bg":         HexColor("#ffffff"),
    "paper":      HexColor("#f8fafc"),
    "border":     HexColor("#e2e8f0"),
    "primary":    HexColor("#2563eb"),
    "violet":     HexColor("#7c3aed"),
    "text":       HexColor("#1e293b"),
    "muted":      HexColor("#64748b"),
    "humano":     HexColor("#16a34a"),
    "automatico": HexColor("#d97706"),
    "bot":        HexColor("#7c3aed"),
    "bot_ia":     HexColor("#9333ea"),
    "green":      HexColor("#16a34a"),
    "white":      HexColor("#0f172a"),
    "wa":         HexColor("#16a34a"),
    "red":        HexColor("#dc2626"),
    "cyan":       HexColor("#0891b2"),
}

CATEGORY_INFO = {
    "humano":        ("Humano",       C["humano"]),
    "automatico":    ("Automatico",   C["automatico"]),
    "hibrido":       ("Auto+Humano",  C["primary"]),
    "bot":           ("Bot",          C["bot"]),
    "bot_ia":        ("Bot IA",       C["bot_ia"]),
    "sin_respuesta": ("Sin respuesta",C["muted"]),
}

# Quality level names and colors (score 0-5)
QUALITY_LEVELS = {
    0: ("Sin respuesta",       C["muted"]),
    1: ("Sin valor comercial", C["red"]),
    2: ("Cortesia vacia",      C["automatico"]),
    3: ("Apertura tibia",      C["primary"]),
    4: ("Interes concreto",    C["cyan"]),
    5: ("Lead caliente",       C["humano"]),
}

# Legend rows shown on page 2
QUALITY_LEGEND = [
    (1, "Sin valor comercial",
     '"Ok", emoji solo, acuse de recibo de 1-2 palabras sin contenido',
     C["red"]),
    (2, "Cortesia vacia",
     '"Ahorita te marco", "Luego hablamos" — reconoce el contacto pero evita el tema',
     C["automatico"]),
    (3, "Apertura tibia",
     '"Mandame info", "De que se trata?" — toca el tema sin compromiso real',
     C["primary"]),
    (4, "Interes concreto",
     'Pregunta especifica, da contexto de su situacion o menciona necesidad de compra',
     C["cyan"]),
    (5, "Lead caliente",
     'Pide cotizacion, propone llamada o reunion, menciona urgencia o presupuesto',
     C["humano"]),
]


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _safe(text) -> str:
    if not text:
        return ""
    s = str(text)
    for src, dst in [
        ("—", "-"), ("–", "-"), ("‘", "'"), ("’", "'"),
        ("“", '"'), ("”", '"'), ("…", "..."), ("·", "."),
        ("•", "-"), ("←", "<"), ("→", ">"), (" ", " "),
    ]:
        s = s.replace(src, dst)
    return s.encode("latin-1", errors="replace").decode("latin-1")

_OrigParagraph = Paragraph

def Paragraph(text, style, *args, **kwargs):  # noqa: N802
    return _OrigParagraph(_safe(text), style, *args, **kwargs)


def _st(name, **kw):
    kw.setdefault("fontName", "Helvetica")
    kw.setdefault("textColor", C["text"])
    kw.setdefault("backColor", None)
    kw.setdefault("leading", 14)
    kw.setdefault("spaceAfter", 0)
    return ParagraphStyle(name, **kw)


def _reaction_str(m) -> str:
    if m is None:
        return "—"
    m = float(m)
    if m < 1:
        return "< 1 min"
    if m < 60:
        return f"{round(m)} min"
    h = int(m // 60); mn = round(m % 60)
    return f"{h}h {mn}m" if mn else f"{h}h"


def _speed_label(reaction_min):
    """Returns (label, color) rating for reaction time."""
    if reaction_min is None:
        return "Sin respuesta", C["muted"]
    m = float(reaction_min)
    if m < 5:
        return "Excelente", C["humano"]
    if m < 30:
        return "Bueno", C["primary"]
    if m < 120:
        return "Regular", C["automatico"]
    return "Lento", C["red"]


_SVC_DIMS = [
    ("svc_prof",   "Profesionalismo"),
    ("svc_comp",   "Completitud"),
    ("svc_empa",   "Empatia"),
    ("svc_solu",   "Solucion ofrecida"),
    ("svc_next",   "Siguiente paso"),
    ("svc_proact", "Proactividad"),
]

_SVC_COLORS = {
    1: HexColor("#dc2626"),
    2: HexColor("#f59e0b"),
    3: HexColor("#2563eb"),
    4: HexColor("#0891b2"),
    5: HexColor("#16a34a"),
}


def _svc_score_color(v):
    v = max(1, min(5, int(round(float(v or 1)))))
    return _SVC_COLORS.get(v, C["muted"])


def _composite_score(analytics: dict, category: str, quality: float, reaction_min, business_hours: bool) -> int:
    """
    Weighted score 0-100.
    When service quality dimensions present (svc_*):
      Calidad de servicio 45%  Señal comercial 20%  Tipo de atención 15%  Velocidad 20%
    Legacy (no svc_* fields):
      Tipo de atención 30%  Calidad comercial 50%  Velocidad 20%
    """
    cat_scores = {
        "humano": 100, "hibrido": 55, "automatico": 35, "bot_ia": 25,
        "bot": 15, "sin_respuesta": 0,
    }
    cat_s  = cat_scores.get(category, 50)
    qual_s = (float(quality or 0) / 5) * 100

    if reaction_min is None:
        spd_s = 0
    else:
        m = float(reaction_min)
        if m < 5:    spd_s = 100
        elif m < 30: spd_s = 80
        elif m < 120:spd_s = 55
        elif m < 480:spd_s = 30
        else:        spd_s = 10

    svc_vals = [float(analytics.get(k)) for k, _ in _SVC_DIMS if analytics.get(k) is not None]
    if svc_vals:
        svc_avg = sum(svc_vals) / len(svc_vals)
        svc_s = (svc_avg - 1) / 4 * 100
        score = svc_s * 0.45 + qual_s * 0.20 + cat_s * 0.15 + spd_s * 0.20
    else:
        score = cat_s * 0.30 + qual_s * 0.50 + spd_s * 0.20

    if business_hours:
        score = min(100, score + 3)
    return round(score)


def _score_label(score: int) -> tuple:
    """Returns (label, color) for a composite score."""
    if score >= 70:
        return "Canal con potencial comercial", C["humano"]
    if score >= 40:
        return "Canal con respuesta limitada", C["automatico"]
    return "Canal sin senal comercial", C["red"]


# ─── Flowables ────────────────────────────────────────────────────────────────

class HGradient(Flowable):
    def __init__(self, w, h, left_hex, right_hex):
        super().__init__()
        self._w, self._h = w, h
        lc = HexColor(left_hex); rc = HexColor(right_hex)
        self._r0, self._g0, self._b0 = lc.red, lc.green, lc.blue
        self._r1, self._g1, self._b1 = rc.red, rc.green, rc.blue

    def wrap(self, *_):
        return (self._w, self._h)

    def draw(self):
        steps = 100
        sw = self._w / steps
        for i in range(steps):
            t = i / steps
            self.canv.setFillColor(Color(
                self._r0 + (self._r1 - self._r0) * t,
                self._g0 + (self._g1 - self._g0) * t,
                self._b0 + (self._b1 - self._b0) * t,
            ))
            self.canv.rect(sw * i, 0, sw + 0.6, self._h, fill=1, stroke=0)
        self.canv.setFillColor(HexColor("#ffffff"))
        self.canv.setFont("Helvetica-Bold", 14)
        self.canv.drawString(12, self._h * 0.35, "Reporte de Canal WhatsApp")


class QualityDots(Flowable):
    def __init__(self, score, color, max_score=5, r=5, gap=4):
        super().__init__()
        self._score = round(float(score or 0))
        self._color = color
        self._max   = max_score
        self._r     = r
        self._gap   = gap

    def wrap(self, *_):
        return (self._max * (self._r * 2 + self._gap), self._r * 2)

    def draw(self):
        for i in range(self._max):
            cx = self._r + i * (self._r * 2 + self._gap)
            cy = self._r
            if i < self._score:
                self.canv.setFillColor(self._color)
                self.canv.circle(cx, cy, self._r, fill=1, stroke=0)
            else:
                self.canv.setFillColor(C["border"])
                self.canv.circle(cx, cy, self._r, fill=1, stroke=0)
                self.canv.setFillColor(C["paper"])
                self.canv.circle(cx, cy, self._r * 0.5, fill=1, stroke=0)


class CardGrid(Flowable):
    def __init__(self, cards, width, card_h=28*mm, gap=4):
        super().__init__()
        self._cards  = cards
        self._width  = width
        self._card_h = card_h
        self._gap    = gap
        self._card_w = (width - gap) / 2

    def wrap(self, *_):
        rows = (len(self._cards) + 1) // 2
        return (self._width, rows * (self._card_h + self._gap) - self._gap)

    def draw(self):
        gap = self._gap; cw = self._card_w; ch = self._card_h
        for idx, (title, value, color, extra) in enumerate(self._cards):
            col = idx % 2; row = idx // 2
            rows_total = (len(self._cards) + 1) // 2
            x = col * (cw + gap)
            y = (rows_total - 1 - row) * (ch + gap)
            self.canv.setFillColor(C["paper"])
            self.canv.roundRect(x, y, cw, ch, 4, fill=1, stroke=0)
            self.canv.setStrokeColor(C["border"])
            self.canv.setLineWidth(0.5)
            self.canv.roundRect(x, y, cw, ch, 4, fill=0, stroke=1)
            self.canv.setFillColor(C["muted"])
            self.canv.setFont("Helvetica-Bold", 7)
            self.canv.drawString(x + 10, y + ch - 16, _safe(title).upper())
            self.canv.setFillColor(color)
            self.canv.setFont("Helvetica-Bold", 17)
            self.canv.drawString(x + 10, y + ch - 36, _safe(str(value)))
            if extra is not None:
                extra.canv = self.canv
                extra.drawOn(self.canv, x + 10, y + ch - 48)


class ScoreBar(Flowable):
    """Horizontal progress bar for composite score 0-100."""
    def __init__(self, score: int, label: str, color, width, h=16*mm):
        super().__init__()
        self._score = max(0, min(100, score))
        self._label = label
        self._color = color
        self._w     = width
        self._h     = h

    def wrap(self, *_):
        return (self._w, self._h)

    def draw(self):
        track_y = self._h * 0.55
        track_h = self._h * 0.22
        # Background track
        self.canv.setFillColor(C["border"])
        self.canv.roundRect(0, track_y, self._w, track_h, 3, fill=1, stroke=0)
        # Filled portion
        filled_w = self._w * (self._score / 100)
        if filled_w > 2:
            self.canv.setFillColor(self._color)
            self.canv.roundRect(0, track_y, filled_w, track_h, 3, fill=1, stroke=0)
        # Score value
        self.canv.setFillColor(self._color)
        self.canv.setFont("Helvetica-Bold", 13)
        self.canv.drawString(0, 4, f"{self._score}/100")
        # Label
        self.canv.setFillColor(C["muted"])
        self.canv.setFont("Helvetica", 8)
        self.canv.drawRightString(self._w, 4, _safe(self._label))


class ServiceQualityTable(Flowable):
    """Compact 2-column table showing the 6 service quality dimensions."""
    def __init__(self, analytics: dict, width, row_h=14):
        super().__init__()
        self._dims = [(label, analytics.get(key)) for key, label in _SVC_DIMS]
        self._w = width
        self._row_h = row_h

    def wrap(self, *_):
        rows = (len(self._dims) + 1) // 2
        return (self._w, rows * self._row_h + 2)

    def draw(self):
        rh = self._row_h
        cw = self._w / 2
        rows_total = (len(self._dims) + 1) // 2
        for idx, (label, val) in enumerate(self._dims):
            col = idx % 2
            row = idx // 2
            x = col * cw
            y = (rows_total - 1 - row) * rh

            # Row background
            self.canv.setFillColor(C["paper"])
            self.canv.rect(x, y, cw - 3, rh, fill=1, stroke=0)

            if val is None:
                # No data
                self.canv.setFillColor(C["muted"])
                self.canv.setFont("Helvetica", 6.5)
                self.canv.drawString(x + 6, y + rh * 0.28, _safe(label))
                self.canv.setFillColor(C["border"])
                self.canv.setFont("Helvetica", 6.5)
                self.canv.drawString(x + cw * 0.6, y + rh * 0.28, "—")
                continue

            v = max(1, min(5, int(round(float(val)))))
            color = _svc_score_color(v)

            # Label
            self.canv.setFillColor(C["muted"])
            self.canv.setFont("Helvetica", 6.5)
            self.canv.drawString(x + 6, y + rh * 0.28, _safe(label))

            # Score value
            self.canv.setFillColor(color)
            self.canv.setFont("Helvetica-Bold", 7.5)
            self.canv.drawString(x + cw * 0.57, y + rh * 0.28, f"{v}/5")

            # Mini dots
            dot_r = 3; dot_gap = 2
            dot_x = x + cw * 0.71
            dot_y = y + rh * 0.42
            for i in range(5):
                cx = dot_x + i * (dot_r * 2 + dot_gap)
                if i < v:
                    self.canv.setFillColor(color)
                    self.canv.circle(cx, dot_y, dot_r, fill=1, stroke=0)
                else:
                    self.canv.setFillColor(C["border"])
                    self.canv.circle(cx, dot_y, dot_r, fill=1, stroke=0)


class SummaryBar(Flowable):
    def __init__(self, sent, recv, read_, width, h=22*mm):
        super().__init__()
        self._data = [
            ("Mensajes enviados",    str(sent),  C["primary"]),
            ("Respuestas recibidas", str(recv),  C["humano"]),
            ("Mensajes leidos",      str(read_), C["muted"]),
        ]
        self._w = width; self._h = h

    def wrap(self, *_):
        return (self._w, self._h)

    def draw(self):
        cw = self._w / 3
        fs_val = max(14, int(self._h * 0.55)); fs_label = 7
        for i, (label, val, color) in enumerate(self._data):
            x = i * cw
            self.canv.setFillColor(C["paper"])
            self.canv.roundRect(x, 0, cw - 3, self._h, 3, fill=1, stroke=0)
            self.canv.setStrokeColor(C["border"])
            self.canv.setLineWidth(0.5)
            self.canv.roundRect(x, 0, cw - 3, self._h, 3, fill=0, stroke=1)
            self.canv.setFillColor(color)
            self.canv.setFont("Helvetica-Bold", fs_val)
            self.canv.drawString(x + 8, self._h * 0.45, _safe(val))
            self.canv.setFillColor(C["muted"])
            self.canv.setFont("Helvetica", fs_label)
            self.canv.drawString(x + 8, 5, _safe(label))


# ─── Page callbacks ───────────────────────────────────────────────────────────

def _page_bg(canv, doc):
    canv.saveState()
    canv.setFillColor(C["bg"])
    canv.rect(0, 0, W, H, fill=1, stroke=0)
    canv.setStrokeColor(HexColor("#e2e8f0"))
    canv.setLineWidth(0.5)
    canv.line(LM, 14 * mm, W - RM, 14 * mm)
    canv.setFillColor(C["muted"])
    canv.setFont("Helvetica", 7)
    canv.drawRightString(W - RM, 10 * mm,
                         f"Analisis de Canal WhatsApp · {datetime.now().strftime('%d/%m/%Y')}")
    canv.restoreState()


# ─── Groq suggestions ─────────────────────────────────────────────────────────

def _suggestions(analytics: dict, industry: str) -> list[str]:
    try:
        key = os.getenv("GROQ_API_KEY", "")
        if not key:
            return []
        from groq import Groq
        client = Groq(api_key=key)

        dim_lines = []
        for field, label in _SVC_DIMS:
            v = analytics.get(field)
            if v is not None:
                dim_lines.append(f"  {label}: {v}/5")
        dims_block = "\n".join(dim_lines) if dim_lines else "  (sin datos de dimensiones)"

        reaction = analytics.get("reaction_time_min")
        reaction_str = f"{reaction} min" if reaction is not None else "sin datos"

        prompt = (
            f"Eres consultor senior de ventas y experiencia de cliente B2B en Mexico.\n"
            f"Empresa del sector '{industry}'. Analisis de su canal WhatsApp:\n"
            f"- Tipo de atencion: {analytics.get('category', '?')}\n"
            f"- Tiempo de respuesta: {reaction_str}\n"
            f"- Senial comercial (1-5): {analytics.get('response_quality', 0)}\n"
            f"- Calidad de servicio por dimension (1-5):\n{dims_block}\n"
            f"- Diagnostico del auditor: {analytics.get('notes') or 'Sin notas'}\n\n"
            f"Genera 4 recomendaciones de mejora CONCRETAS e INNOVADORAS para el canal WhatsApp.\n"
            f"REGLAS:\n"
            f"- Prioriza las dimensiones con puntuacion 1-2 (las mas deficientes)\n"
            f"- Propone acciones especificas y medibles, no consejos genericos\n"
            f"- Adapta cada sugerencia al sector '{industry}'\n"
            f"- Maximo 120 caracteres por sugerencia\n"
            f"- Sin numeracion, sin bullets, sin guiones. Una sugerencia por linea.\n"
            f"- Sé innovador: incluye tacticas como mensajes de voz, videos cortos, "
            f"automatizacion inteligente, segmentacion por urgencia, o tecnicas de venta consultiva."
        )
        resp = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=500,
            temperature=0.4,
        )
        lines = [l.strip("•-– 1234567890.)") for l in resp.choices[0].message.content.strip().split("\n") if l.strip()]
        return [l for l in lines if len(l) > 10][:4]
    except Exception:
        return []


# ─── Main generator ───────────────────────────────────────────────────────────

def generate_report(company: dict, analytics: dict, thread: list, screenshot_b64: str | None) -> io.BytesIO:
    def _safe_dict(d):
        if isinstance(d, dict):  return {k: _safe_dict(v) for k, v in d.items()}
        if isinstance(d, list):  return [_safe_dict(i) for i in d]
        if isinstance(d, str):   return _safe(d)
        return d

    company   = _safe_dict(company)
    analytics = _safe_dict(analytics)
    thread    = _safe_dict(thread)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                            leftMargin=LM, rightMargin=RM,
                            topMargin=TM, bottomMargin=BM)

    try:
        now_str = datetime.now().strftime("%-d de %B de %Y, %H:%M")
    except ValueError:
        now_str = datetime.now().strftime("%d de %B de %Y, %H:%M")

    company_name = _safe(company.get("name") or company.get("domain") or "Empresa")
    industry     = _safe(company.get("industry") or analytics.get("industry") or "-")
    domain       = _safe(company.get("domain") or "")
    wa_number    = ""
    for ct in (company.get("contacts") or []):
        if ct.get("type") == "whatsapp":
            wa_number = _safe(ct.get("value", ""))
            break

    # ── Analytics values ──────────────────────────────────────────────────────
    cat_key              = analytics.get("category", "humano")
    cat_label, cat_color = CATEGORY_INFO.get(cat_key, ("Desconocido", C["muted"]))
    quality              = float(analytics.get("response_quality") or 0)
    reaction_min         = analytics.get("reaction_time_min")
    try:
        reaction_min = float(reaction_min) if reaction_min is not None else None
    except (TypeError, ValueError):
        reaction_min = None
    business_hours       = bool(analytics.get("business_hours", False))
    notes                = _safe(analytics.get("notes") or "")
    is_ai                = bool(analytics.get("is_ai", False))
    bot_quality          = analytics.get("bot_quality")

    qual_level, qual_color = QUALITY_LEVELS.get(round(quality), ("Desconocido", C["muted"]))
    speed_label, speed_color = _speed_label(reaction_min)
    composite = _composite_score(analytics, cat_key, quality, reaction_min, business_hours)
    score_label, score_color = _score_label(composite)

    sent_c = sum(1 for m in thread if m.get("direction") == "outbound")
    recv_c = sum(1 for m in thread if m.get("direction") == "inbound")
    read_c = sum(1 for m in thread if m.get("status") == "read")

    suggestions = [_safe(s) for s in (_suggestions(analytics, industry) or [])] or [
        "Activar respuestas automaticas fuera de horario para no perder prospectos.",
        "Configurar un mensaje de bienvenida con precios y servicios principales.",
        "Reducir el tiempo de respuesta a menos de 10 minutos durante horario habil.",
        "Usar etiquetas de WhatsApp Business para clasificar leads por nivel de interes.",
    ]

    story = []

    # ══════════════════════════════════════════════════════════════════════════
    # PAGE 1 — Portada + Diagnóstico
    # ══════════════════════════════════════════════════════════════════════════

    story.append(HGradient(PW, 16 * mm, "#3b82f6", "#8b5cf6"))
    story.append(Spacer(1, 5 * mm))

    # Company header
    meta_lines = []
    if wa_number:
        meta_lines.append(Paragraph(
            f'<font color="#25d366">&#9679;</font>  <font color="#1e293b"><b>{wa_number}</b></font>',
            _st("wn", fontSize=10, leading=15)))
    if domain:
        meta_lines.append(Paragraph(domain, _st("dm", fontSize=9, textColor=C["muted"], leading=13)))
    meta_lines.append(Paragraph(now_str, _st("dt2", fontSize=8, textColor=C["muted"], leading=12)))

    header_table = Table(
        [[Paragraph(company_name, _st("cn", fontSize=18, fontName="Helvetica-Bold",
                                      textColor=C["white"], leading=22)),
          [Paragraph(industry, _st("ci", fontSize=10, textColor=C["muted"], leading=14))] + meta_lines]],
        colWidths=[PW * 0.55, PW * 0.45],
    )
    header_table.setStyle(TableStyle([
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING",   (0, 0), (-1, -1), 0),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
        ("TOPPADDING",    (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 4 * mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=C["border"], spaceAfter=4))

    # ── Section: Diagnóstico del Canal ────────────────────────────────────────
    story.append(Paragraph("Diagnostico del Canal", _st("h3",
        fontSize=11, fontName="Helvetica-Bold", textColor=C["primary"],
        leading=15, spaceAfter=4)))

    # 4-card grid
    bh_label = "En horario habil" if business_hours else "Fuera de horario"
    bh_color = C["humano"] if business_hours else C["automatico"]

    story.append(CardGrid(
        cards=[
            ("Tipo de atencion",    cat_label,               cat_color,   None),
            ("Calidad comercial",   f"{round(quality)}/5",   qual_color,  QualityDots(quality, qual_color)),
            ("Velocidad de respuesta", _reaction_str(reaction_min), speed_color, None),
            ("Horario de atencion", bh_label,                bh_color,    None),
        ],
        width=PW,
        card_h=26 * mm,
        gap=4,
    ))
    story.append(Spacer(1, 3 * mm))

    # Nivel de calidad label
    story.append(Paragraph(
        f'Nivel: <b><font color="#{qual_color.hexval()[-6:] if hasattr(qual_color,"hexval") else "1e293b"}">{qual_level}</font></b>'
        f'&nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp;Respuesta: <b>{speed_label}</b>'
        f'{"&nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp;Bot IA: Si" if is_ai else ""}',
        _st("ql", fontSize=8, textColor=C["muted"], leading=11, spaceAfter=3),
    ))

    # Notas del clasificador (diagnóstico clínico)
    if notes:
        notes_data = [
            [Paragraph("Diagnostico:", _st("dlb", fontSize=8, fontName="Helvetica-Bold",
                                           textColor=C["muted"])),
             Paragraph(notes, _st("dln", fontSize=9, textColor=C["text"], leading=13))],
        ]
        notes_tbl = Table(notes_data, colWidths=[24 * mm, PW - 24 * mm - 4])
        notes_tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), C["paper"]),
            ("BOX",           (0, 0), (-1, -1), 0.5, C["border"]),
            ("LEFTPADDING",   (0, 0), (-1, -1), 8),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 10),
            ("TOPPADDING",    (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ("VALIGN",        (0, 0), (-1, -1), "TOP"),
        ]))
        story.append(notes_tbl)
        story.append(Spacer(1, 3 * mm))

    # Puntuación global
    story.append(Paragraph("Puntuacion Global", _st("sg",
        fontSize=9, fontName="Helvetica-Bold", textColor=C["muted"],
        leading=12, spaceAfter=2)))
    story.append(ScoreBar(composite, score_label, score_color, PW, h=14 * mm))
    story.append(Spacer(1, 3 * mm))

    # Check if new svc dims are present
    has_svc = any(analytics.get(k) is not None for k, _ in _SVC_DIMS)

    if has_svc:
        story.append(Paragraph(
            "Ponderacion: Calidad de servicio 45% · Senial comercial 20% · Tipo de atencion 15% · Velocidad 20%",
            _st("crit", fontSize=7, textColor=C["muted"], leading=10),
        ))
        story.append(Spacer(1, 3 * mm))
        story.append(Paragraph("Desglose de Calidad de Servicio", _st("sqh",
            fontSize=9, fontName="Helvetica-Bold", textColor=C["primary"],
            leading=12, spaceAfter=2)))
        story.append(ServiceQualityTable(analytics, PW, row_h=14))
    else:
        story.append(Paragraph(
            "Ponderacion: Tipo de atencion 30% · Calidad comercial 50% · Velocidad de respuesta 20%",
            _st("crit", fontSize=7, textColor=C["muted"], leading=10),
        ))

    story.append(Spacer(1, 3 * mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=C["border"], spaceAfter=4))

    # Metrics bar
    story.append(SummaryBar(sent_c, recv_c, read_c, PW, h=18 * mm))

    # ══════════════════════════════════════════════════════════════════════════
    # PAGE 2 — Leyenda + Evidencia
    # ══════════════════════════════════════════════════════════════════════════
    story.append(PageBreak())

    story.append(Paragraph("Metodologia de Evaluacion", _st("h5",
        fontSize=11, fontName="Helvetica-Bold", textColor=C["primary"],
        leading=15, spaceAfter=3)))
    story.append(Paragraph(
        "Dos ejes independientes: calidad del servicio entregado y señal comercial del prospecto.",
        _st("sub", fontSize=8, textColor=C["muted"], leading=11, spaceAfter=5),
    ))

    # Service quality dimensions legend
    story.append(Paragraph("Dimensiones de Calidad de Servicio (1-5 cada una)", _st("sqtitle",
        fontSize=9, fontName="Helvetica-Bold", textColor=C["text"],
        leading=12, spaceAfter=3)))
    svc_legend = [
        ("Profesionalismo", "Ortografia, tono apropiado, coherencia y claridad del mensaje"),
        ("Completitud",     "¿Respondio lo que se pregunto o solicito?"),
        ("Empatia",         "Calidez, personalizacion, reconoce y valida la necesidad"),
        ("Solucion ofrecida","¿Ofrecio algo concreto? (precio, producto, alternativa, cita)"),
        ("Siguiente paso",  "¿Quedo claro que sigue? (CTA explicito: llamada, reunion, link)"),
        ("Proactividad",    "Anticipo necesidades, hizo preguntas de calificacion, ofrecio info extra"),
    ]
    for dim_name, dim_desc in svc_legend:
        dim_row = Table(
            [[Paragraph(dim_name, _st(f"dn_{dim_name}",
                  fontSize=8, fontName="Helvetica-Bold", textColor=C["primary"])),
              Paragraph(dim_desc, _st(f"dd_{dim_name}",
                  fontSize=8, textColor=C["muted"], leading=11))]],
            colWidths=[38 * mm, PW - 38 * mm - 4],
        )
        dim_row.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), C["paper"]),
            ("BOX",           (0, 0), (-1, -1), 0.5, C["border"]),
            ("LEFTPADDING",   (0, 0), (-1, -1), 8),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 10),
            ("TOPPADDING",    (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ]))
        story.append(dim_row)
        story.append(Spacer(1, 1.5 * mm))

    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph("Escala de Señal Comercial (1-5)", _st("sqtitle2",
        fontSize=9, fontName="Helvetica-Bold", textColor=C["text"],
        leading=12, spaceAfter=3)))
    story.append(Paragraph(
        "¿Que tan caliente quedo el lead con esta interaccion?",
        _st("sub3", fontSize=8, textColor=C["muted"], leading=11, spaceAfter=3),
    ))

    for score_val, level_name, description, lv_color in QUALITY_LEGEND:
        row = Table(
            [[Paragraph(str(score_val), _st(f"lv{score_val}",
                  fontSize=14, fontName="Helvetica-Bold", textColor=lv_color)),
              [Paragraph(level_name, _st(f"ln{score_val}",
                   fontSize=9, fontName="Helvetica-Bold", textColor=lv_color, leading=13)),
               Paragraph(description, _st(f"ld{score_val}",
                   fontSize=8, textColor=C["muted"], leading=11))]]],
            colWidths=[10 * mm, PW - 10 * mm - 4],
        )
        row.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), C["paper"]),
            ("BOX",           (0, 0), (-1, -1), 0.5, C["border"]),
            ("LEFTPADDING",   (0, 0), (-1, -1), 8),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 10),
            ("TOPPADDING",    (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ]))
        story.append(row)
        story.append(Spacer(1, 2 * mm))

    story.append(Spacer(1, 4 * mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=C["border"], spaceAfter=5))

    # Evidencia de conversación
    story.append(Paragraph("Evidencia de Conversacion", _st("h2",
        fontSize=11, fontName="Helvetica-Bold", textColor=C["primary"],
        leading=14, spaceAfter=4)))

    if screenshot_b64:
        try:
            raw     = screenshot_b64.split(",", 1)[-1] if "," in screenshot_b64 else screenshot_b64
            img_buf = io.BytesIO(base64.b64decode(raw))
            img     = Image(img_buf, width=PW, height=90 * mm, kind="bound")
            story.append(img)
        except Exception:
            story.append(Paragraph("(No se pudo procesar la imagen.)",
                _st("ni", textColor=C["muted"], fontSize=9)))
    else:
        story.append(Paragraph("Sin captura de pantalla.",
            _st("ni2", textColor=C["muted"], fontSize=9)))

    caption_parts = [p for p in [company_name, wa_number, datetime.now().strftime("%d/%m/%Y")] if p]
    story.append(Paragraph(" · ".join(caption_parts),
        _st("cap", fontSize=7, textColor=C["muted"], alignment=TA_CENTER, spaceAfter=0)))

    # ══════════════════════════════════════════════════════════════════════════
    # PAGE 3 — Sugerencias de Mejora
    # ══════════════════════════════════════════════════════════════════════════
    story.append(PageBreak())

    story.append(Paragraph("Sugerencias de Mejora", _st("h4",
        fontSize=11, fontName="Helvetica-Bold", textColor=C["green"],
        leading=15, spaceAfter=5)))
    story.append(Paragraph(
        f"Basadas en el analisis del canal de {company_name} — sector {industry}.",
        _st("sub2", fontSize=8, textColor=C["muted"], leading=11, spaceAfter=6),
    ))

    for i, text in enumerate(suggestions, 1):
        sug_row = Table(
            [[Paragraph(str(i), _st(f"bn{i}",
                fontSize=12, fontName="Helvetica-Bold", textColor=C["green"])),
              Paragraph(text, _st(f"bt{i}",
                fontSize=9, textColor=C["text"], leading=13))]],
            colWidths=[8 * mm, PW - 8 * mm - 4],
        )
        sug_row.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), C["paper"]),
            ("BOX",           (0, 0), (-1, -1), 0.5, C["border"]),
            ("LEFTPADDING",   (0, 0), (-1, -1), 8),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 10),
            ("TOPPADDING",    (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ]))
        story.append(sug_row)
        story.append(Spacer(1, 3 * mm))

    story.append(Spacer(1, 4 * mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=C["border"], spaceAfter=4))
    story.append(Paragraph(
        f'<font color="#64748b">Analisis de Canal WhatsApp · {now_str}</font>',
        _st("bn", fontSize=7, alignment=TA_CENTER, leading=11),
    ))

    # ── Build ─────────────────────────────────────────────────────────────────
    _orig_build = doc.build
    def _safe_build(*a, **kw):
        from reportlab.pdfgen.canvas import Canvas
        _orig_ds  = Canvas.drawString
        _orig_drs = Canvas.drawRightString
        _orig_dcs = Canvas.drawCentredString
        Canvas.drawString        = lambda s, x, y, t, *ar, **kw: _orig_ds(s, x, y, _safe(t), *ar, **kw)
        Canvas.drawRightString   = lambda s, x, y, t, *ar, **kw: _orig_drs(s, x, y, _safe(t), *ar, **kw)
        Canvas.drawCentredString = lambda s, x, y, t, *ar, **kw: _orig_dcs(s, x, y, _safe(t), *ar, **kw)
        try:
            return _orig_build(*a, **kw)
        finally:
            Canvas.drawString        = _orig_ds
            Canvas.drawRightString   = _orig_drs
            Canvas.drawCentredString = _orig_dcs

    doc.build = _safe_build
    doc.build(story, onFirstPage=_page_bg, onLaterPages=_page_bg)
    buf.seek(0)
    return buf
