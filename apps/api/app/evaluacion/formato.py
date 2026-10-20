"""Formato de la conversación real para la evaluación: textos de WhatsApp a HTML seguro y
fechas/horas como las escribe la plantilla ("Lunes, 10 de agosto de 2026", "11:05 a.m.").

La plantilla pinta cada mensaje con innerHTML, así que el texto que escribió la empresa (o
cualquiera) se escapa SIEMPRE aquí y solo se convierte el formato de WhatsApp (*negritas*,
_cursivas_, ~tachado~, saltos de línea) a etiquetas que generamos nosotros.
"""
import html
import re
from datetime import datetime, timedelta, timezone

MX = timezone(timedelta(hours=-6))  # America/Mexico_City, UTC-6 todo el año (igual que classifier.py)
DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre",
         "octubre", "noviembre", "diciembre"]

# Formato de WhatsApp: el marcador pegado a texto (no a espacios) por dentro.
_FMT = [
    (re.compile(r"(?<![\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])"), "b"),
    (re.compile(r"(?<![\w_])_(?=\S)([^_\n]*?\S)_(?![\w_])"), "i"),
    (re.compile(r"(?<![\w~])~(?=\S)([^~\n]*?\S)~(?![\w~])"), "s"),
]


def whatsapp_a_html(texto: str | None) -> str:
    """Texto de WhatsApp → HTML seguro para la burbuja del chat."""
    if not texto:
        return ""
    s = html.escape(str(texto).replace("\r\n", "\n"), quote=True)
    for patron, etiqueta in _FMT:
        s = patron.sub(lambda m: f"<{etiqueta}>{m.group(1)}</{etiqueta}>", s)
    # Las llaves se escriben como entidades: un "{{algo}}" de terceros no es una variable del generador.
    return s.replace("{", "&#123;").replace("}", "&#125;").replace("\n", "<br>")


def texto_plano(texto: str | None, maximo: int | None = None) -> str:
    """Texto de un solo renglón, sin llaves, para títulos y frases (la plantilla los escapa)."""
    s = re.sub(r"\s+", " ", str(texto or "")).strip().replace("{", "(").replace("}", ")")
    if maximo and len(s) > maximo:
        s = s[:maximo - 1].rsplit(" ", 1)[0].rstrip(",.;:") + "…"  # con el "…" nunca pasa del tope
    return s


def a_mx(dt: datetime) -> datetime:
    """Fechas guardadas sin zona son UTC (contenedores en UTC)."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(MX)


def fecha_dia(dt: datetime) -> str:
    d = a_mx(dt)
    return f"{DIAS[d.weekday()]}, {d.day} de {MESES[d.month - 1]} de {d.year}"


def hora(dt: datetime) -> str:
    d = a_mx(dt)
    h12 = d.hour % 12 or 12
    return f"{h12}:{d.minute:02d} {'a.m.' if d.hour < 12 else 'p.m.'}"


def fecha_evaluacion(dt: datetime) -> str:
    d = a_mx(dt)
    return f"{d.day} de {MESES[d.month - 1]} de {d.year}, {d.hour:02d}:{d.minute:02d} h"


def periodo(inicio: datetime, fin: datetime) -> str:
    a, b = a_mx(inicio), a_mx(fin)
    if a.date() == b.date():
        return f"el {a.day} de {MESES[a.month - 1]} de {a.year}"
    if a.year == b.year:
        return f"del {a.day} de {MESES[a.month - 1]} al {b.day} de {MESES[b.month - 1]} de {b.year}"
    return f"del {a.day} de {MESES[a.month - 1]} de {a.year} al {b.day} de {MESES[b.month - 1]} de {b.year}"


def duracion(segundos: float) -> str:
    """'14 h 21 min', '35 min', '45 s' (como las notas de la conversación)."""
    s = int(round(segundos))
    if s < 60:
        return f"{s} s"
    m = s // 60
    if m < 60:
        return f"{m} min"
    h, m = divmod(m, 60)
    if h >= 48 and not m:
        return f"{h // 24} días"
    return f"{h} h {m} min" if m else f"{h} h"


# Ladas de país más comunes para los clientes (América y algunos de Europa), de la más larga a la más corta.
_PAISES = sorted(["1", "34", "51", "52", "53", "54", "55", "56", "57", "58", "502", "503", "504", "505", "506",
                  "507", "591", "593", "595", "598"], key=len, reverse=True)
_GRUPOS = {10: (3, 3, 4), 9: (3, 3, 3), 8: (4, 4)}


def telefono(numero: str | None) -> str:
    """5213311171010 → '+52 33 1117 1010'; 573102388245 → '+57 310 238 8245'; otro: '+' y dígitos."""
    d = re.sub(r"\D", "", numero or "")
    if d.startswith("521") and len(d) == 13:
        d = "52" + d[3:]
    if d.startswith("52") and len(d) == 12:
        n = d[2:]
        lada = 2 if n[:2] in ("33", "55", "56", "81") else 3
        resto = n[lada:]
        return f"+52 {n[:lada]} {resto[:len(resto) - 4]} {resto[-4:]}"
    for pais in _PAISES:
        nacional = d[len(pais):]
        if d.startswith(pais) and len(nacional) in _GRUPOS:
            partes, i = [], 0
            for g in _GRUPOS[len(nacional)]:
                partes.append(nacional[i:i + g])
                i += g
            return f"+{pais} " + " ".join(partes)
    return f"+{d}" if d else ""
