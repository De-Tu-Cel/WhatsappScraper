# report_generator.py
import base64
import io
import math
import os
from datetime import datetime

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, Color
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    Image, Flowable, HRFlowable,
)
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT

W, H = A4
LM = 12 * mm
RM = 12 * mm
TM = 18 * mm
BM = 18 * mm
PW = W - LM - RM   # usable page width ≈ 527 pt

C = {
    "bg":         HexColor("#ffffff"),
    "paper":      HexColor("#f8fafc"),
    "border":     HexColor("#e2e8f0"),
    "primary":    HexColor("#2563eb"),
    "violet":     HexColor("#7c3aed"),
    "text":       HexColor("#1e293b"),
    "muted":      HexColor("#64748b"),
    "humano":     HexColor("#16a34a"),
    "amber":      HexColor("#d97706"),
    "bot":        HexColor("#7c3aed"),
    "bot_ia":     HexColor("#9333ea"),
    "green":      HexColor("#16a34a"),
    "white":      HexColor("#0f172a"),
    "wa":         HexColor("#16a34a"),
    "red":        HexColor("#dc2626"),
    "cyan":       HexColor("#0891b2"),
}

CATEGORY_INFO = {
    "humano":         ("Persona real",        C["humano"]),
    "automatico":     ("Resp. automatica",    C["amber"]),
    "hibrido":        ("Bot + asesor",        C["primary"]),
    "bot":            ("Chatbot",             C["bot"]),
    # "menu" ya no es categoría propia en el reporte — un IVR numérico se fusionó con
    # "bot" (mismo label/color), así los reportes viejos con esa categoría no quedan
    # como "Desconocido".
    "menu":           ("Chatbot",             C["bot"]),
    "bot_ia":         ("Asistente IA",        C["bot_ia"]),
    "sin_respuesta":  ("Sin respuesta",       C["muted"]),
}

CATEGORY_DESCRIPTIONS = {
    "humano":         "El canal es atendido por una persona real que responde manualmente a cada mensaje.",
    "automatico":     "El canal responde de forma automatica sin intervencion humana detectada.",
    "hibrido":        "El canal combina respuestas automaticas iniciales con atencion humana posterior.",
    "bot":            "El canal usa un chatbot o sistema automatizado (con o sin IA conversacional) para gestionar las conversaciones.",
    "menu":           "El canal usa un chatbot o sistema automatizado (con o sin IA conversacional) para gestionar las conversaciones.",
    "bot_ia":         "El canal usa un asistente de inteligencia artificial conversacional.",
    "sin_respuesta":  "El canal no respondio al contacto realizado durante el periodo analizado.",
}

# Quality level names and colors (score 0-5)
QUALITY_LEVELS = {
    0: ("Sin respuesta",       C["muted"]),
    1: ("Sin valor comercial", C["red"]),
    2: ("Cortesia vacia",      C["amber"]),
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
     C["amber"]),
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


_MONTHS_ES = {
    'January': 'enero', 'February': 'febrero', 'March': 'marzo',
    'April': 'abril', 'May': 'mayo', 'June': 'junio',
    'July': 'julio', 'August': 'agosto', 'September': 'septiembre',
    'October': 'octubre', 'November': 'noviembre', 'December': 'diciembre',
}

def _mx_now():
    from datetime import datetime as _dt
    try:
        from zoneinfo import ZoneInfo
        return _dt.now(ZoneInfo("America/Mexico_City"))
    except Exception:
        return _dt.now()

def _date_es(dt=None) -> str:
    d = dt or _mx_now()
    month_es = _MONTHS_ES.get(d.strftime('%B'), d.strftime('%B').lower())
    return f"{d.day} de {month_es} de {d.year}, {d.strftime('%H:%M')}"


def _st(name, **kw):
    kw.setdefault("fontName", "Helvetica")
    kw.setdefault("textColor", C["text"])
    kw.setdefault("backColor", None)
    kw.setdefault("leading", 14)
    kw.setdefault("spaceAfter", 0)
    return ParagraphStyle(name, **kw)


def _reaction_str(m, seconds=None) -> str:
    """`m` = reaction_time_min (redondeado a 0.1 min = bloques de 6s — se usa
    para minutos/horas, donde ese redondeo no importa). `seconds` = valor exacto
    sin redondear a bloques; si se pasa y la respuesta fue menor a 1 minuto, se
    usa ese en vez de derivarlo de `m` — evita que 3-9s reales se vean todos
    igual como "6 seg"."""
    if m is None:
        return "—"
    m = float(m)
    if m < 1:
        if seconds is not None:
            return f"{round(float(seconds))} seg"
        return f"{round(m * 60)} seg"
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
        return "Regular", C["amber"]
    return "Lento", C["red"]


def _business_hours_label(business_hours):
    """(label, color) para el horario de respuesta. business_hours puede ser
    True/False/None — None significa "no hay dato" (ej. la empresa solo tiene
    mensajes salientes, sin ninguna respuesta analizada todavía) y NO debe
    mostrarse como "Fuera de horario", que afirmaría algo que no sabemos."""
    if business_hours is None:
        return "Sin datos", C["muted"]
    return ("En horario habil", C["humano"]) if business_hours else ("Fuera de horario", C["amber"])


_SVC_DIMS = [
    ("svc_prof",   "Profesionalismo"),
    ("svc_comp",   "Respuesta completa"),
    ("svc_empa",   "Trato al cliente"),
    ("svc_solu",   "Solucion ofrecida"),
    ("svc_next",   "Siguiente paso claro"),
    ("svc_proact", "Iniciativa propia"),
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
        "humano": 100, "hibrido": 55, "automatico": 35,
        "bot_ia": 25, "bot": 15, "menu": 15, "sin_respuesta": 0,
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
        return "Buen potencial de venta", C["humano"]
    if score >= 40:
        return "Atencion con areas de mejora", C["amber"]
    return "Canal sin respuesta comercial", C["red"]


# ─── Flowables ────────────────────────────────────────────────────────────────

class HGradient(Flowable):
    def __init__(self, w, h, left_hex, right_hex, badge_text="", company_name=""):
        super().__init__()
        self._w, self._h = w, h
        lc = HexColor(left_hex); rc = HexColor(right_hex)
        self._r0, self._g0, self._b0 = lc.red, lc.green, lc.blue
        self._r1, self._g1, self._b1 = rc.red, rc.green, rc.blue
        self._badge = badge_text
        self._company = company_name

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
        # Title + company name — vertically centered as a two-line block
        self.canv.setFillColor(HexColor("#ffffff"))
        if self._company:
            label_size   = 7
            company_size = 13
            line_gap     = 3          # gap between the two lines
            block_h      = label_size + line_gap + company_size
            block_y      = (self._h - block_h) / 2   # bottom of block
            self.canv.setFont("Helvetica", label_size)
            self.canv.drawString(12, block_y + company_size + line_gap, "REPORTE DE CANAL WHATSAPP")
            self.canv.setFont("Helvetica-Bold", company_size)
            self.canv.drawString(12, block_y, _safe(self._company))
        else:
            self.canv.setFont("Helvetica-Bold", 13)
            self.canv.drawString(12, (self._h - 13) / 2, "Reporte de Canal WhatsApp")
        # Industry badge (right side)
        if self._badge:
            badge = _safe(self._badge)
            font_size = 8
            self.canv.setFont("Helvetica", font_size)
            bw = self.canv.stringWidth(badge, "Helvetica", font_size)
            pad_x = 9
            bh = 16
            bx = self._w - bw - pad_x * 2 - 10
            by = (self._h - bh) / 2
            self.canv.setFillColor(Color(1, 1, 1, 0.18))
            self.canv.roundRect(bx, by, bw + pad_x * 2, bh, 4, fill=1, stroke=0)
            self.canv.setStrokeColor(Color(1, 1, 1, 0.4))
            self.canv.setLineWidth(0.5)
            self.canv.roundRect(bx, by, bw + pad_x * 2, bh, 4, fill=0, stroke=1)
            self.canv.setFillColor(HexColor("#ffffff"))
            # vertically center: baseline = by + (bh - ascent) / 2, ascent ≈ font_size * 0.72
            text_y = by + (bh - font_size * 0.72) / 2
            self.canv.drawString(bx + pad_x, text_y, badge)


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
            # Card background
            self.canv.setFillColor(C["paper"])
            self.canv.roundRect(x, y, cw, ch, 4, fill=1, stroke=0)
            # Card border
            self.canv.setStrokeColor(C["border"])
            self.canv.setLineWidth(0.5)
            self.canv.roundRect(x, y, cw, ch, 4, fill=0, stroke=1)
            # Accent left strip (3pt wide, matches value color)
            self.canv.setFillColor(color)
            self.canv.roundRect(x, y, 3, ch, 2, fill=1, stroke=0)
            # Label
            self.canv.setFillColor(C["muted"])
            self.canv.setFont("Helvetica-Bold", 6.5)
            self.canv.drawString(x + 11, y + ch - 15, _safe(title).upper())
            # Value
            self.canv.setFillColor(color)
            self.canv.setFont("Helvetica-Bold", 16)
            self.canv.drawString(x + 11, y + ch - 34, _safe(str(value)))
            if extra is not None:
                extra.canv = self.canv
                extra.drawOn(self.canv, x + 11, y + max(ch - 46, 5))


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


class ScoreArc(Flowable):
    """Circular arc gauge 0-100 drawn with thick rounded stroke path."""
    def __init__(self, score: int, color, size=54):
        super().__init__()
        self._score = max(0, min(100, score))
        self._color = color
        self._size  = size

    def wrap(self, *_):
        return (self._size, self._size)

    def draw(self):
        sz = self._size
        cx, cy = sz / 2, sz / 2
        r  = sz * 0.34
        sw = sz * 0.095

        def _arc_stroke(color, start_deg, end_deg):
            if abs(end_deg - start_deg) < 0.5:
                return
            self.canv.setStrokeColor(color)
            self.canv.setLineWidth(sw)
            self.canv.setLineCap(1)
            steps = 72
            s = math.radians(start_deg)
            e = math.radians(end_deg)
            p = self.canv.beginPath()
            for i in range(steps + 1):
                t = i / steps
                a = s + (e - s) * t
                px = cx + r * math.cos(a)
                py = cy + r * math.sin(a)
                if i == 0:
                    p.moveTo(px, py)
                else:
                    p.lineTo(px, py)
            self.canv.drawPath(p, stroke=1, fill=0)

        # Background: 225° → -45° (CW sweep of 270°)
        _arc_stroke(C["border"], 225, -45)
        # Foreground
        if self._score > 0:
            _arc_stroke(self._color, 225, 225 - 270 * self._score / 100)

        # Score number (center)
        self.canv.setFillColor(self._color)
        self.canv.setFont("Helvetica-Bold", max(9, int(sz * 0.215)))
        self.canv.drawCentredString(cx, cy + sz * 0.06, str(self._score))
        # "/100" sub-label
        self.canv.setFillColor(C["muted"])
        self.canv.setFont("Helvetica", max(6, int(sz * 0.125)))
        self.canv.drawCentredString(cx, cy - sz * 0.13, "/100")


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

_report_company_name = ""  # set at generate time, used in footer


def _page_bg(canv, doc):
    canv.saveState()
    canv.setFillColor(C["bg"])
    canv.rect(0, 0, W, H, fill=1, stroke=0)
    canv.setStrokeColor(HexColor("#e2e8f0"))
    canv.setLineWidth(0.5)
    canv.line(LM, 14 * mm, W - RM, 14 * mm)
    canv.setFillColor(C["muted"])
    canv.setFont("Helvetica", 7)
    left_text = _safe(_report_company_name) if _report_company_name else "De Tu Cel"
    canv.drawString(LM, 10 * mm, left_text)
    canv.drawRightString(W - RM, 10 * mm,
                         f"Analisis de Canal WhatsApp · {_mx_now().strftime('%d/%m/%Y %H:%M')}")
    canv.restoreState()


# ─── AI suggestions ───────────────────────────────────────────────────────────

def _calc_avg_response_time(thread: list) -> float | None:
    """Average minutes between each outbound message and the next inbound reply."""
    pairs = []
    pending_out = None
    for msg in sorted(thread, key=lambda m: m.get("created_at") or ""):
        if msg.get("direction") == "outbound":
            pending_out = msg
        elif msg.get("direction") == "inbound" and pending_out:
            sent = pending_out.get("created_at")
            recv = msg.get("created_at")
            if sent and recv:
                try:
                    if isinstance(sent, str):
                        sent = datetime.fromisoformat(sent.replace("Z", "+00:00"))
                    if isinstance(recv, str):
                        recv = datetime.fromisoformat(recv.replace("Z", "+00:00"))
                    delta = (recv - sent).total_seconds() / 60
                    if 0 < delta <= 1440:
                        pairs.append(delta)
                except Exception:
                    pass
            pending_out = None
    return round(sum(pairs) / len(pairs), 1) if pairs else None


def _suggestions(analytics: dict, industry: str, avg_response_min=None) -> list[str]:
    """Generate 5 specific, innovative improvement suggestions via AI."""
    weak_dims = []
    strong_dims = []
    for field, label in _SVC_DIMS:
        v = analytics.get(field)
        if v is not None:
            score = float(v)
            if score <= 2:
                weak_dims.append(f"{label} ({int(score)}/5)")
            elif score >= 4:
                strong_dims.append(f"{label} ({int(score)}/5)")

    reaction = analytics.get("reaction_time_min")
    reaction_str = _reaction_str(reaction) if reaction is not None else "sin datos"
    avg_str = _reaction_str(avg_response_min) if avg_response_min is not None else "sin datos"
    cat = analytics.get("category", "humano")
    quality = analytics.get("response_quality", 0)
    notes = analytics.get("notes") or "Sin notas"

    # Benchmark context for Mexico B2B WhatsApp
    benchmark_note = ""
    if reaction is not None:
        r = float(reaction)
        if r < 5:
            benchmark_note = "Tiempo de 1a respuesta EXCELENTE (top 10% del mercado mexicano)."
        elif r < 30:
            benchmark_note = "Tiempo de 1a respuesta bueno. Referencia: mejor practica <5 min."
        elif r < 120:
            benchmark_note = "Tiempo de 1a respuesta regular. La media MX PYME es 47 min; el objetivo ideal es <10 min."
        else:
            benchmark_note = "Tiempo de 1a respuesta lento. 68% de prospectos mexicanos abandona si no hay respuesta en 2 horas."

    weak_block   = ", ".join(weak_dims)   if weak_dims   else "ninguna critica detectada"
    strong_block = ", ".join(strong_dims) if strong_dims else "ninguna destacada"

    prompt = (
        f"Eres un asesor de negocios que ayuda a duenos de empresas en Mexico a mejorar su atencion por WhatsApp.\n"
        f"Tu cliente tiene un negocio en el sector '{industry}'. Escribe recomendaciones claras y practicas.\n\n"
        f"DATOS DEL CANAL:\n"
        f"- Como respondieron: {cat}\n"
        f"- Tiempo de 1a respuesta: {reaction_str}\n"
        f"- Tiempo promedio de respuesta: {avg_str}\n"
        f"- Interes del prospecto: {quality}/5\n"
        f"- Aspectos a mejorar: {weak_block}\n"
        f"- Aspectos positivos: {strong_block}\n"
        f"- Diagnostico: {notes}\n"
        f"- Referencia del mercado: {benchmark_note}\n\n"
        f"TAREA: Genera exactamente 5 recomendaciones de mejora. Cada una debe:\n"
        f"1. Estar escrita en lenguaje simple que cualquier dueno de negocio entienda sin conocimientos tecnicos\n"
        f"2. Ser una accion concreta que puedan hacer esta semana (no proyectos largos)\n"
        f"3. Explicar QUE hacer y POR QUE les va a ayudar a conseguir mas clientes o vender mas\n"
        f"4. Usar ejemplos de acciones del dia a dia: guardar contactos, responder a tiempo, dar seguimiento, etc.\n"
        f"5. Comenzar con un verbo en infinitivo y tener maximo 180 caracteres\n\n"
        f"PROHIBIDO: terminos tecnicos como API, CRM, n8n, webhook, automatizacion avanzada.\n"
        f"PROHIBIDO: consejos vagos como 'mejorar la comunicacion' sin decir exactamente como.\n"
        f"FORMATO: Una recomendacion por linea. Sin numeracion, bullets ni guiones al inicio."
    )

    try:
        from app.llm import call_llm, active_provider
        if active_provider() != "none":
            content = call_llm([{"role": "user", "content": prompt}], max_tokens=700, temperature=0.4)
            lines = [l.strip("•-– \t") for l in content.split("\n") if l.strip()]
            result = [l for l in lines if len(l) > 20][:5]
            if result:
                return result
    except Exception:
        pass

    return []


# ─── Main generator ───────────────────────────────────────────────────────────

def generate_report(company: dict, analytics: dict, thread: list, screenshot_b64: str | None) -> io.BytesIO:
    global _report_company_name

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

    now_str = _date_es()

    company_name = _safe(company.get("name") or company.get("domain") or "Empresa")
    _report_company_name = company_name
    industry     = _safe(company.get("industry") or analytics.get("industry") or "-")
    domain       = _safe(company.get("domain") or "")
    wa_number    = ""
    for ct in (company.get("contacts") or []):
        if ct.get("type") == "whatsapp":
            wa_number = _safe(ct.get("value", ""))
            break

    # ── Analytics values ──────────────────────────────────────────────────────
    # analytics.get("category", "humano") NO alcanza cuando la llave existe con
    # valor None (pasa cuando la empresa solo tiene salientes, sin ninguna
    # respuesta analizada aún — ver get_analytics() en database.py) — el default
    # de .get() solo aplica si la llave falta por completo, no si vale None.
    # Sin este chequeo explícito, ese caso caía en "Desconocido" como si fuera
    # un error, cuando en realidad es "todavía no hay nada que clasificar".
    cat_key = analytics.get("category")
    is_ai   = bool(analytics.get("is_ai", False))
    if cat_key is None:
        cat_label, cat_color = "Pendiente de analisis", C["muted"]
    else:
        cat_label, cat_color = CATEGORY_INFO.get(cat_key, ("Desconocido", C["muted"]))
    # Refine label when the bot is confirmed conversational AI
    if cat_key == "bot" and is_ai:
        cat_label = "Bot con IA"
        cat_color = C["bot_ia"]
    quality              = float(analytics.get("response_quality") or 0)
    reaction_min         = analytics.get("reaction_time_min")
    try:
        reaction_min = float(reaction_min) if reaction_min is not None else None
    except (TypeError, ValueError):
        reaction_min = None
    reaction_seconds = analytics.get("reaction_time_seconds")
    try:
        reaction_seconds = float(reaction_seconds) if reaction_seconds is not None else None
    except (TypeError, ValueError):
        reaction_seconds = None
    # Igual que category: .get(key, False) no aplica el default si la llave
    # existe con valor None — se preserva el tri-estado (True/False/None) y se
    # resuelve en _business_hours_label(), que sí distingue "sin dato" de
    # "fuera de horario" (antes ambos casos se veían idénticos en el reporte).
    business_hours = analytics.get("business_hours")
    notes          = _safe(analytics.get("notes") or "")

    qual_level, qual_color   = QUALITY_LEVELS.get(round(quality), ("Desconocido", C["muted"]))
    speed_label, speed_color = _speed_label(reaction_min)
    bh_label, bh_color = _business_hours_label(business_hours)

    sent_c = sum(1 for m in thread if m.get("direction") == "outbound")
    recv_c = sum(1 for m in thread if m.get("direction") == "inbound")

    # NOTE: avg response time, score, svc dims and suggestions are kept for future use
    # avg_resp_min = _calc_avg_response_time(thread)
    # suggestions  = _suggestions(analytics, industry, avg_resp_min)
    # comp_score   = _composite_score(analytics, cat_key, quality, reaction_min, business_hours)

    # ── Column widths for 2-column body layout ────────────────────────────────
    LEFT_W  = PW * 0.40   # screenshot column ~211pt / ~74mm
    RIGHT_W = PW * 0.57   # data column     ~301pt / ~106mm
    COL_GAP = int(PW * 0.03)  # gap between columns ~16pt

    story = []

    # ══════════════════════════════════════════════════════════════════════════
    # HEADER — full width, compact
    # ══════════════════════════════════════════════════════════════════════════
    story.append(HGradient(PW, 16 * mm, "#3b82f6", "#8b5cf6", badge_text=industry, company_name=company_name))
    story.append(Spacer(1, 3 * mm))

    meta_lines = []
    if wa_number:
        meta_lines.append(Paragraph(
            f'<font color="#25d366">&#9679;</font>  <font color="#1e293b"><b>{wa_number}</b></font>',
            _st("wn", fontSize=9, leading=12, alignment=TA_RIGHT)))
    if domain:
        meta_lines.append(Paragraph(domain, _st("dm", fontSize=8, textColor=C["muted"], leading=11, alignment=TA_RIGHT)))
    meta_lines.append(Paragraph(now_str, _st("dt2", fontSize=7.5, textColor=C["muted"], leading=10, alignment=TA_RIGHT)))

    header_tbl = Table(
        [[Paragraph(company_name, _st("cn", fontSize=15, fontName="Helvetica-Bold",
                                      textColor=C["white"], leading=19)),
          meta_lines]],
        colWidths=[PW * 0.55, PW * 0.45],
    )
    header_tbl.setStyle(TableStyle([
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
        ("ALIGN",         (1, 0), (1, -1),  "RIGHT"),
        ("LEFTPADDING",   (0, 0), (-1, -1), 0),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
        ("TOPPADDING",    (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(header_tbl)
    story.append(Spacer(1, 2 * mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=C["border"], spaceAfter=4))

    # ══════════════════════════════════════════════════════════════════════════
    # LEFT COLUMN — screenshot
    # ══════════════════════════════════════════════════════════════════════════
    left_items = []
    left_items.append(Paragraph("Evidencia de Conversacion", _st("evh",
        fontSize=7.5, fontName="Helvetica-Bold", textColor=C["muted"],
        leading=10, spaceAfter=3)))

    if screenshot_b64:
        try:
            raw     = screenshot_b64.split(",", 1)[-1] if "," in screenshot_b64 else screenshot_b64
            img_buf = io.BytesIO(base64.b64decode(raw))
            img     = Image(img_buf, width=LEFT_W, height=162 * mm, kind="bound")
            img.hAlign = "CENTER"
            img_wrapper = Table([[img]], colWidths=[LEFT_W])
            img_wrapper.setStyle(TableStyle([
                ("ALIGN",         (0, 0), (-1, -1), "CENTER"),
                ("LEFTPADDING",   (0, 0), (-1, -1), 0),
                ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
                ("TOPPADDING",    (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]))
            left_items.append(img_wrapper)
        except Exception:
            left_items.append(Paragraph("(No se pudo procesar la imagen.)",
                _st("ni", textColor=C["muted"], fontSize=8)))
    else:
        left_items.append(Paragraph("Sin captura de pantalla adjunta.",
            _st("ni2", textColor=C["muted"], fontSize=8)))

    caption_parts = [p for p in [wa_number, company_name, _mx_now().strftime("%d/%m/%Y")] if p]
    left_items.append(Spacer(1, 2 * mm))
    left_items.append(Paragraph(" · ".join(caption_parts),
        _st("cap", fontSize=6, textColor=C["muted"], leading=8, alignment=TA_CENTER)))

    # ══════════════════════════════════════════════════════════════════════════
    # RIGHT COLUMN — chat type classification
    # ══════════════════════════════════════════════════════════════════════════
    right_items = []

    cat_description = CATEGORY_DESCRIPTIONS.get(cat_key, "")

    # — Section label —
    right_items.append(Paragraph("CLASIFICACION DEL CANAL", _st("clabel",
        fontSize=7, fontName="Helvetica-Bold", textColor=C["muted"],
        leading=9, spaceAfter=3)))

    # — Large classification card —
    cat_tbl = Table(
        [[Paragraph(cat_label,
                    _st("cval", fontSize=26, fontName="Helvetica-Bold",
                        textColor=cat_color, leading=30))]],
        colWidths=[RIGHT_W],
    )
    cat_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), C["paper"]),
        ("BOX",           (0, 0), (-1, -1), 0.5, C["border"]),
        ("LINEBEFORE",    (0, 0), (0, -1),  4,   cat_color),
        ("LEFTPADDING",   (0, 0), (-1, -1), 14),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 14),
        ("TOPPADDING",    (0, 0), (-1, -1), 12),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
    ]))
    right_items.append(cat_tbl)
    right_items.append(Spacer(1, 3 * mm))

    # — Description of this category —
    if cat_description:
        desc_tbl = Table(
            [[Paragraph(cat_description, _st("cdesc", fontSize=9, textColor=C["text"], leading=13))]],
            colWidths=[RIGHT_W],
        )
        desc_tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), C["paper"]),
            ("BOX",           (0, 0), (-1, -1), 0.5, C["border"]),
            ("LEFTPADDING",   (0, 0), (-1, -1), 10),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 10),
            ("TOPPADDING",    (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ]))
        right_items.append(desc_tbl)
        right_items.append(Spacer(1, 3 * mm))

    # — Classifier diagnostic notes —
    if notes:
        right_items.append(Paragraph("Diagnostico del clasificador", _st("notesh",
            fontSize=7, fontName="Helvetica-Bold", textColor=C["muted"], leading=9, spaceAfter=2)))
        notes_tbl = Table(
            [[Paragraph(notes, _st("notes", fontSize=8, textColor=C["text"], leading=12))]],
            colWidths=[RIGHT_W],
        )
        notes_tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), HexColor("#f8faff")),
            ("BOX",           (0, 0), (-1, -1), 0.5, C["border"]),
            ("LINEBEFORE",    (0, 0), (0, -1),  3,   C["muted"]),
            ("LEFTPADDING",   (0, 0), (-1, -1), 10),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 10),
            ("TOPPADDING",    (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        right_items.append(notes_tbl)
        right_items.append(Spacer(1, 3 * mm))

    # — Supporting context: reaction time + message counts —
    right_items.append(HRFlowable(width=RIGHT_W, thickness=0.5, color=C["border"], spaceAfter=4))
    right_items.append(Paragraph("Datos del contacto", _st("dh",
        fontSize=7.5, fontName="Helvetica-Bold", textColor=C["muted"],
        leading=10, spaceAfter=3)))

    def _info_row(label, value, color):
        t = Table(
            [[Paragraph(label, _st(f"il_{label}", fontSize=7.5, textColor=C["muted"], leading=10)),
              Paragraph(value, _st(f"iv_{label}", fontSize=7.5, fontName="Helvetica-Bold",
                                   textColor=color, leading=10, alignment=TA_RIGHT))]],
            colWidths=[RIGHT_W * 0.6, RIGHT_W * 0.4],
        )
        t.setStyle(TableStyle([
            ("LEFTPADDING",   (0, 0), (-1, -1), 0),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
            ("TOPPADDING",    (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ]))
        return t

    reaction_str = _reaction_str(reaction_min, reaction_seconds) if reaction_min is not None else "Sin datos"
    react_color  = speed_color
    # Show the speed label inline with the time value ("17 seg · Excelente")
    reaction_display = f"{reaction_str} - {speed_label}" if reaction_min is not None else "Sin datos"
    bh_label, bh_color = _business_hours_label(business_hours)

    right_items.append(_info_row("Tiempo de primera respuesta", reaction_display, react_color))
    # right_items.append(_info_row("Horario de respuesta",        bh_label,         bh_color))
    # if quality > 0:
    #     right_items.append(_info_row("Calidad del prospecto",
    #                                  f"{qual_level}  ({round(quality)}/5)", qual_color))
    right_items.append(_info_row("Mensajes enviados",           str(sent_c),  C["primary"]))
    right_items.append(_info_row("Mensajes recibidos",          str(recv_c),  C["primary"]))

    # — Service quality dimensions (svc_*) from LLM evaluation —
    has_svc = any(analytics.get(k) is not None for k, _ in _SVC_DIMS)
    if has_svc:
        right_items.append(Spacer(1, 3 * mm))
        right_items.append(HRFlowable(width=RIGHT_W, thickness=0.5, color=C["border"], spaceAfter=4))
        right_items.append(Paragraph("Calidad de atencion", _st("svch",
            fontSize=7.5, fontName="Helvetica-Bold", textColor=C["muted"],
            leading=10, spaceAfter=3)))
        right_items.append(ServiceQualityTable(analytics, RIGHT_W))

    # ── PRESERVED FOR FUTURE USE (not rendered) ───────────────────────────────
    # The following sections exist in this file and can be re-enabled:
    #   _composite_score()  — weighted 0-100 score with ScoreArc gauge
    #   _suggestions()      — 5 AI-generated improvement tips via LLM
    #   CardGrid            — 6 metric cards (quality, speed, hours, msg counts)
    #   QualityDots         — 1-5 dot indicator for commercial lead score
    #   ScoreArc / ScoreBar — circular / bar gauge flowables
    # ─────────────────────────────────────────────────────────────────────────

    # ══════════════════════════════════════════════════════════════════════════
    # BODY — 2-column table: screenshot | data
    # ══════════════════════════════════════════════════════════════════════════
    body_tbl = Table(
        [[left_items, right_items]],
        colWidths=[LEFT_W, RIGHT_W],
    )
    body_tbl.setStyle(TableStyle([
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING",   (0, 0), (-1, -1), 0),
        ("TOPPADDING",    (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING",  (0, 0), (0, -1),  COL_GAP),
        ("RIGHTPADDING",  (1, 0), (-1, -1), 0),
    ]))
    story.append(body_tbl)

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
