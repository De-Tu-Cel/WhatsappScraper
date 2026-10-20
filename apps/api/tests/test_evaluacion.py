"""Evaluación del canal WhatsApp: el generador en Python produce EXACTAMENTE el mismo HTML que
generar.js (la herramienta original del equipo de diseño) con las mismas entradas.

Las huellas son las de salida/diesgas.html y salida/ejemplo-restaurante.html generadas con
`node generar.js` (2026-10-20). Si se cambia plantilla.html o un JSON a propósito, se
regeneran con node y se actualizan aquí.
"""
import hashlib
import json
from pathlib import Path

import pytest

from datetime import datetime, timezone

from app.evaluacion import formato, generador

FX = Path(__file__).resolve().parent / "fixtures" / "evaluacion"
NODE_SHA256 = {
    "diesgas": "fbf58eda2c8c65b2",
    "ejemplo-restaurante": "3e84412f294aa4fe",
}


def _cfg(name):
    return json.loads((FX / f"{name}.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("name", sorted(NODE_SHA256))
def test_python_generator_matches_generar_js_byte_for_byte(name):
    html = generador.generar_evaluacion(_cfg(name), raices_assets=[FX])
    assert hashlib.sha256(html.encode("utf-8")).hexdigest()[:16] == NODE_SHA256[name]


def test_html_is_self_contained():
    html = generador.generar_evaluacion(_cfg("diesgas"), raices_assets=[FX])
    assert "assets/" not in html.split("<script", 1)[0].split("</style>")[-1]  # sin rutas sueltas en el <head>
    assert '"logo":"data:image/webp;base64,' in html and "url(data:font/woff2;base64," in html
    assert "<title>Evaluación del canal WhatsApp de Diesgas | De Tu Cel</title>" in html


def test_invalid_configurations_are_refused_with_a_clear_reason():
    cfg = _cfg("diesgas")
    cfg["conversacion"]["real"][1]["pin"] = "7"  # no hay oportunidad 7
    with pytest.raises(generador.ConfiguracionInvalida, match='pin "7" sin oportunidad'):
        generador.generar_evaluacion(cfg, raices_assets=[FX])
    with pytest.raises(generador.ConfiguracionInvalida, match="industria desconocida"):
        generador.generar_evaluacion({**_cfg("diesgas"), "industria": "panaderias"})
    sin_nombre = _cfg("diesgas")
    sin_nombre["cliente"]["nombre"] = ""
    with pytest.raises(generador.ConfiguracionInvalida, match="cliente.nombre"):
        generador.generar_evaluacion(sin_nombre, raices_assets=[FX])


def test_company_text_is_escaped_and_only_whatsapp_formatting_becomes_html():
    # La plantilla pinta los mensajes con innerHTML: lo que escribe la empresa nunca entra como HTML.
    assert formato.whatsapp_a_html('<script>alert(1)</script> & "hola"') == \
        "&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;hola&quot;"
    assert formato.whatsapp_a_html("*Guarda este número* como _Diesgas pedidos_\n~precio viejo~") == \
        "<b>Guarda este número</b> como <i>Diesgas pedidos</i><br><s>precio viejo</s>"
    assert formato.whatsapp_a_html("2 * 3 = 6, mi_correo_x@a.com") == "2 * 3 = 6, mi_correo_x@a.com"
    assert formato.whatsapp_a_html('<img src=x onerror="alert(1)">*b*') == \
        "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;<b>b</b>"


def test_dates_and_times_read_like_the_diesgas_example():
    utc = timezone.utc
    assert formato.fecha_dia(datetime(2026, 8, 10, 17, 5, tzinfo=utc)) == "Lunes, 10 de agosto de 2026"
    assert formato.hora(datetime(2026, 8, 10, 17, 5)) == "11:05 a.m."  # sin zona = UTC
    assert formato.hora(datetime(2026, 10, 9, 0, 51, tzinfo=utc)) == "6:51 p.m."
    assert formato.hora(datetime(2026, 10, 9, 18, 0, tzinfo=utc)) == "12:00 p.m."
    assert formato.fecha_evaluacion(datetime(2026, 10, 9, 14, 55, tzinfo=utc)) == "9 de octubre de 2026, 08:55 h"
    assert formato.periodo(datetime(2026, 8, 10, 17), datetime(2026, 10, 9, 16)) == "del 10 de agosto al 9 de octubre de 2026"
    assert formato.periodo(datetime(2025, 12, 30, 17), datetime(2026, 1, 2, 17)) == "del 30 de diciembre de 2025 al 2 de enero de 2026"
    assert formato.duracion(14 * 3600 + 21 * 60) == "14 h 21 min" and formato.duracion(3) == "3 s"
    assert formato.telefono("5213311171010") == "+52 33 1117 1010"
    assert formato.telefono("524422161010") == "+52 442 216 1010"


def test_trimmed_text_never_exceeds_its_limit():
    assert formato.texto_plano("x" * 50, 20) == "x" * 19 + "…"
    assert formato.texto_plano("Atender y tomar pedidos las veinticuatro horas del día", 30) == "Atender y tomar pedidos las…"
    assert len(formato.texto_plano("palabra " * 20, 33)) <= 33
    assert formato.texto_plano("  corto  {x} ", 30) == "corto (x)"


def test_layers_merge_like_the_original():
    assert generador.mezclar({"a": {"x": 1, "y": 2}, "l": [1, 2]}, {"a": {"y": 3}, "l": [9]}) == {"a": {"x": 1, "y": 3}, "l": [9]}
    ctx = {"cliente": {"nombre": "Gas X"}, "n": 3, "ok": True}
    assert generador.interpolar("{{cliente.nombre}} nivel {{n}} {{ok}} {{nada}}", ctx) == "Gas X nivel 3 true "
    assert generador.industrias() == ["gaseras", "restaurantes"]
