# report_generator.py
import base64
import io
import os
import re
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
    "bg":         HexColor("#0d1117"),
    "paper":      HexColor("#161d2e"),
    "border":     HexColor("#1e2a3a"),
    "primary":    HexColor("#3b82f6"),
    "violet":     HexColor("#8b5cf6"),
    "text":       HexColor("#e2e8f0"),
    "muted":      HexColor("#64748b"),
    "humano":     HexColor("#4ade80"),
    "automatico": HexColor("#facc15"),
    "bot":        HexColor("#a78bfa"),
    "bot_ia":     HexColor("#c084fc"),
    "green":      HexColor("#4ade80"),
    "white":      HexColor("#ffffff"),
    "wa":         HexColor("#25d366"),
}

CATEGORY_INFO = {
    "humano":     ("Humano",      C["humano"]),
    "automatico": ("Automático",  C["automatico"]),
    "bot":        ("Bot",         C["bot"]),
    "bot_ia":     ("Bot IA",      C["bot_ia"]),
}


def _st(name, **kw):
    kw.setdefault("fontName", "Helvetica")
    kw.setdefault("textColor", C["text"])
    kw.setdefault("backColor", None)
    kw.setdefault("leading", 14)
    kw.setdefault("spaceAfter", 0)
    return ParagraphStyle(name, **kw)


# ─── Flowables ────────────────────────────────────────────────────────────────

class HGradient(Flowable):
    """Horizontal gradient band."""
    def __init__(self, w, h, left_hex, right_hex):
        super().__init__()
        self._w, self._h = w, h
        lc = HexColor(left_hex)
        rc = HexColor(right_hex)
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
        # Brand text overlaid on gradient
        self.canv.setFillColor(C["white"])
        self.canv.setFont("Helvetica-Bold", 20)
        self.canv.drawString(12, self._h * 0.35, "DeTuCel")
        self.canv.setFillColor(HexColor("#cbd5e1"))
        self.canv.setFont("Helvetica", 10)
        self.canv.drawString(12 + 90, self._h * 0.35, "Reporte de Canal WhatsApp")


class QualityDots(Flowable):
    """Draws filled/hollow circles for a quality score."""
    def __init__(self, score, color, max_score=5, r=5, gap=4):
        super().__init__()
        self._score = round(float(score or 0))
        self._color = color
        self._max = max_score
        self._r = r
        self._gap = gap

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
    """2×2 grid of metric cards."""
    def __init__(self, cards, width, card_h=28*mm, gap=4):
        super().__init__()
        self._cards = cards   # list of (title, value, color, extra_flowable|None)
        self._width = width
        self._card_h = card_h
        self._gap = gap
        self._card_w = (width - gap) / 2

    def wrap(self, *_):
        rows = (len(self._cards) + 1) // 2
        return (self._width, rows * (self._card_h + self._gap) - self._gap)

    def draw(self):
        gap = self._gap
        cw  = self._card_w
        ch  = self._card_h
        for idx, (title, value, color, extra) in enumerate(self._cards):
            col = idx % 2
            row = idx // 2
            rows_total = (len(self._cards) + 1) // 2
            x = col * (cw + gap)
            y = (rows_total - 1 - row) * (ch + gap)
            # Card bg
            self.canv.setFillColor(C["paper"])
            self.canv.roundRect(x, y, cw, ch, 4, fill=1, stroke=0)
            # Card border
            self.canv.setStrokeColor(C["border"])
            self.canv.setLineWidth(0.5)
            self.canv.roundRect(x, y, cw, ch, 4, fill=0, stroke=1)
            # Title
            self.canv.setFillColor(C["muted"])
            self.canv.setFont("Helvetica-Bold", 7)
            self.canv.drawString(x + 10, y + ch - 16, title.upper())
            # Value
            self.canv.setFillColor(color)
            self.canv.setFont("Helvetica-Bold", 17)
            self.canv.drawString(x + 10, y + ch - 36, str(value))
            # Extra (e.g. QualityDots rendered inline)
            if extra is not None:
                extra.canv = self.canv
                extra.drawOn(self.canv, x + 10, y + ch - 48)


class SummaryBar(Flowable):
    """3-column summary bar: Enviados / Recibidos / Leídos."""
    def __init__(self, sent, recv, read_, width, h=22*mm):
        super().__init__()
        self._data = [
            ("Mensajes enviados",    str(sent),  C["primary"]),
            ("Respuestas recibidas", str(recv),  C["humano"]),
            ("Mensajes leídos",      str(read_), C["muted"]),
        ]
        self._w = width
        self._h = h

    def wrap(self, *_):
        return (self._w, self._h)

    def draw(self):
        cw = self._w / 3
        fs_val   = max(14, int(self._h * 0.55))
        fs_label = 7
        for i, (label, val, color) in enumerate(self._data):
            x = i * cw
            self.canv.setFillColor(C["paper"])
            self.canv.roundRect(x, 0, cw - 3, self._h, 3, fill=1, stroke=0)
            self.canv.setStrokeColor(C["border"])
            self.canv.setLineWidth(0.5)
            self.canv.roundRect(x, 0, cw - 3, self._h, 3, fill=0, stroke=1)
            self.canv.setFillColor(color)
            self.canv.setFont("Helvetica-Bold", fs_val)
            self.canv.drawString(x + 8, self._h * 0.45, val)
            self.canv.setFillColor(C["muted"])
            self.canv.setFont("Helvetica", fs_label)
            self.canv.drawString(x + 8, 5, label)


# ─── Page callbacks ───────────────────────────────────────────────────────────

def _page_bg(canv, doc):
    """Background + footer drawn before content on every page."""
    canv.saveState()
    # Dark background
    canv.setFillColor(C["bg"])
    canv.rect(0, 0, W, H, fill=1, stroke=0)
    # Footer separator
    canv.setStrokeColor(C["border"])
    canv.setLineWidth(0.5)
    canv.line(LM, 14 * mm, W - RM, 14 * mm)
    # Footer text
    canv.setFillColor(C["muted"])
    canv.setFont("Helvetica", 7)
    canv.drawRightString(W - RM, 10 * mm,
                         f"Generado por DeTuCel · detucel.mx · {datetime.now().strftime('%d/%m/%Y')}")
    canv.restoreState()


# ─── Groq suggestions ─────────────────────────────────────────────────────────

def _suggestions(analytics: dict, industry: str) -> list[str]:
    try:
        key = os.getenv("GROQ_API_KEY", "")
        if not key:
            return []
        from groq import Groq
        client = Groq(api_key=key)
        prompt = (
            f"Eres un consultor de ventas B2B especializado en canales WhatsApp en México.\n"
            f"Empresa del sector '{industry}'. Métricas de su canal WhatsApp:\n"
            f"- Tipo de atención: {analytics.get('category','?')}\n"
            f"- Calidad de respuesta (1-5): {analytics.get('response_quality', 0)}\n"
            f"- Tiempo de reacción: {analytics.get('reaction_time_min', 0)} minutos\n"
            f"- Dentro de horario hábil: {analytics.get('business_hours')}\n"
            f"- Notas: {analytics.get('notes') or 'Sin notas'}\n\n"
            f"Genera exactamente 4 sugerencias de mejora concretas para su canal WhatsApp. "
            f"Una por línea, sin numeración ni viñetas, máximo 110 caracteres cada una, en español."
        )
        resp = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=400,
            temperature=0.3,
        )
        lines = [l.strip("•-– 1234567890.") for l in resp.choices[0].message.content.strip().split("\n") if l.strip()]
        return [l for l in lines if l][:4]
    except Exception:
        return []


# ─── Main generator ───────────────────────────────────────────────────────────

def generate_report(company: dict, analytics: dict, thread: list, screenshot_b64: str | None) -> io.BytesIO:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=LM, rightMargin=RM,
        topMargin=TM, bottomMargin=BM,
    )

    now_str     = datetime.now().strftime("%-d de %B de %Y, %H:%M") if hasattr(datetime, '_') else datetime.now().strftime("%d de %B de %Y, %H:%M")
    # Windows-safe date format
    try:
        now_str = datetime.now().strftime("%-d de %B de %Y, %H:%M")
    except ValueError:
        now_str = datetime.now().strftime("%d de %B de %Y, %H:%M")

    company_name = company.get("name") or company.get("domain") or "Empresa"
    industry     = company.get("industry") or analytics.get("industry") or "—"
    domain       = company.get("domain") or ""
    wa_number    = ""
    for c in (company.get("contacts") or []):
        if c.get("type") == "whatsapp":
            wa_number = c.get("value", "")
            break

    cat_key             = analytics.get("category", "humano")
    cat_label, cat_color = CATEGORY_INFO.get(cat_key, ("Desconocido", C["muted"]))
    quality             = float(analytics.get("response_quality") or 0)
    reaction            = float(analytics.get("reaction_time_min") or 0)
    biz_hours           = analytics.get("business_hours")

    def reaction_str(m):
        if m is None: return "—"
        m = float(m)
        if m < 1: return "< 1 min"
        if m < 60: return f"{round(m)} min"
        h = int(m // 60); mn = round(m % 60)
        return f"{h}h {mn}m" if mn else f"{h}h"

    sent_c = sum(1 for m in thread if m.get("direction") == "outbound")
    recv_c = sum(1 for m in thread if m.get("direction") == "inbound")
    read_c = sum(1 for m in thread if m.get("status") == "read")

    hours_label = ("Horario hábil" if biz_hours else ("Fuera de horario" if biz_hours is not None else "—"))
    hours_color = C["humano"] if biz_hours else C["muted"]

    suggestions = _suggestions(analytics, industry) or [
        "Activar respuestas automáticas fuera de horario para no perder prospectos.",
        "Configurar un mensaje de bienvenida con precios y servicios principales.",
        "Reducir el tiempo de respuesta a menos de 10 minutos durante horario hábil.",
        "Usar etiquetas de WhatsApp Business para clasificar leads por nivel de interés.",
    ]

    story = []

    # ── PAGE 1: Portada + Análisis ─────────────────────────────────────────────

    # Gradient header
    story.append(HGradient(PW, 16 * mm, "#3b82f6", "#8b5cf6"))
    story.append(Spacer(1, 5 * mm))

    # Company name + metadata in a two-column layout
    meta_lines = []
    if wa_number:
        meta_lines.append(
            Paragraph(f'<font color="#25d366">&#9679;</font>  <font color="#e2e8f0"><b>{wa_number}</b></font>',
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
    story.append(Spacer(1, 5 * mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=C["border"], spaceAfter=5))

    # Section title
    story.append(Paragraph("Análisis del Canal", _st("h3",
        fontSize=11, fontName="Helvetica-Bold", textColor=C["primary"],
        leading=15, spaceAfter=5)))

    # Cards + summary side by side: cards left, summary right
    story.append(CardGrid(
        cards=[
            ("Categoría",           cat_label,              cat_color,   None),
            ("Calidad de respuesta","",                      cat_color,   QualityDots(quality, cat_color)),
            ("Tiempo de reacción",  reaction_str(reaction), C["primary"], None),
            ("Horario",             hours_label,            hours_color,  None),
        ],
        width=PW,
        card_h=24 * mm,
        gap=4,
    ))
    story.append(Spacer(1, 4 * mm))
    story.append(SummaryBar(sent_c, recv_c, read_c, PW, h=18 * mm))

    # ── PAGE 2: Screenshot + Sugerencias ──────────────────────────────────────
    story.append(PageBreak())

    # Screenshot section
    story.append(Paragraph("Evidencia de Conversación", _st("h2",
        fontSize=11, fontName="Helvetica-Bold", textColor=C["primary"],
        leading=15, spaceAfter=5)))
    story.append(HRFlowable(width="100%", thickness=0.5, color=C["border"], spaceAfter=6))

    if screenshot_b64:
        try:
            raw = screenshot_b64.split(",", 1)[-1] if "," in screenshot_b64 else screenshot_b64
            img_buf = io.BytesIO(base64.b64decode(raw))
            img = Image(img_buf, width=PW, height=120 * mm, kind="bound")
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

    story.append(Spacer(1, 5 * mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=C["border"], spaceAfter=5))

    # Suggestions section
    story.append(Paragraph("Sugerencias de Mejora", _st("h4",
        fontSize=11, fontName="Helvetica-Bold", textColor=C["green"],
        leading=15, spaceAfter=5)))

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
            ("ROUNDEDCORNERS",(0, 0), (-1, -1), 3),
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
        f'<font color="#64748b">Generado por </font>'
        f'<font color="#3b82f6"><b>DeTuCel</b></font>'
        f'<font color="#64748b"> · detucel.mx · {now_str}</font>',
        _st("bn", fontSize=7, alignment=TA_CENTER, leading=11),
    ))

    doc.build(story, onFirstPage=_page_bg, onLaterPages=_page_bg)
    buf.seek(0)
    return buf
