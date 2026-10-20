"""Arma la evaluación desde datos de la app: la conversación real de Diesgas (la de la evaluación
que hizo el equipo a mano) reconstruida como vendría de message_logs debe salir con los mismos
días, horas y notas de espera; lo que escribe el negocio nunca entra como HTML; el borrador
del modelo se valida (pines, ventajas, longitudes) y sin modelo hay respaldo por reglas.
"""
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.evaluacion import armador, generador

FX = Path(__file__).resolve().parent / "fixtures" / "evaluacion"
MESES = {"agosto": 8, "octubre": 10}


def _diesgas_thread():
    """La conversación real de diesgas.json como filas de get_conversation_thread (UTC, sin zona)."""
    real = json.loads((FX / "diesgas.json").read_text(encoding="utf-8"))["conversacion"]["real"]
    thread, dia = [], None
    for m in real:
        if m["tipo"] == "dia":
            d, mes, anio = re.search(r"(\d+) de (\w+) de (\d+)", m["texto"]).groups()
            dia = (int(anio), MESES[mes], int(d))
        elif m["tipo"] in ("cliente", "negocio"):
            h, mi, ampm = re.match(r"(\d+):(\d+) ([ap])", m["hora"]).groups()
            hora = int(h) % 12 + (12 if ampm == "p" else 0)
            local = datetime(*dia, hora, int(mi))
            texto = re.sub(r"<[^>]+>", "", m["texto"].replace("<br>", "\n"))
            thread.append({"direction": "outbound" if m["tipo"] == "cliente" else "inbound", "body": texto,
                           "created_at": (local + timedelta(hours=6)).isoformat()})
    return thread


def _armar(thread=None, verdict=None, **kw):
    return armador.armar_cliente(company={"name": "Diesgas", "logo_url": None}, thread=thread or _diesgas_thread(),
                                 numero="5213311171010", verdict=verdict or {"category": "automatico"},
                                 industria="gaseras", whatsapp_name="Diesgas pedidos",
                                 ahora=datetime(2026, 10, 9, 14, 55, tzinfo=timezone.utc),
                                 bajar_logo=lambda url: None, **kw)


def test_the_real_diesgas_chat_comes_out_like_the_manual_evaluation():
    capa, info = _armar(usar_llm=False)
    real = capa["conversacion"]["real"]
    dias = [m["texto"] for m in real if m["tipo"] == "dia"]
    notas = [m["texto"] for m in real if m["tipo"] == "nota"]
    assert dias == ["Lunes, 10 de agosto de 2026", "Jueves, 8 de octubre de 2026", "Viernes, 9 de octubre de 2026"]
    assert notas == ["Sin respuesta en el chat", "14 h 21 min después"]
    # La nota de "sin respuesta" va justo después de la pregunta del tanque (11:08 a.m.)…
    i = next(k for k, m in enumerate(real) if m["texto"] == "Sin respuesta en el chat")
    assert real[i - 1]["hora"] == "11:08 a.m." and real[i - 1]["tipo"] == "cliente"
    # …y la espera de 14 h 21 min, antes del día siguiente.
    j = next(k for k, m in enumerate(real) if m["texto"] == "14 h 21 min después")
    assert real[j + 1]["tipo"] == "dia" and real[j + 2]["hora"] == "9:13 a.m."
    assert capa["nivel"]["hoy"] == 3 and info["nivel_fuente"] == "clasificacion" and info["origen"] == "reglas"
    assert capa["evaluacion"] == {"fecha": "9 de octubre de 2026, 08:55 h",
                                  "periodo": "del 10 de agosto al 9 de octubre de 2026"}
    assert capa["cliente"]["telefono"] == "+52 33 1117 1010" and capa["cliente"]["nombreBot"] == "Diesgas pedidos"
    # Las reglas encuentran las tres oportunidades del caso real.
    datos = [o["dato"] for o in capa["oportunidades"]]
    assert datos == ["Sin respuesta", "14 h de espera", "Pedido por llamada"]
    assert capa["resuelve"] == {"b2": "1", "b1": "2", "b3": "3"}
    assert "+52 442 216 1010" in capa["oportunidades"][2]["vimos"]
    html = generador.generar_evaluacion(capa)  # pasa la validación del generador (pines incluidos)
    assert "Evaluación del canal WhatsApp de Diesgas" in html


def test_business_text_never_becomes_html_or_a_template_variable():
    thread = _diesgas_thread()
    thread[1]["body"] = '<img src=x onerror="alert(1)"> {{cliente.nombre}} *Gas LP*'
    capa, _ = _armar(thread=thread, usar_llm=False)
    texto = next(m["texto"] for m in capa["conversacion"]["real"] if m["tipo"] == "negocio")
    assert texto == "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &#123;&#123;cliente.nombre&#125;&#125; <b>Gas LP</b>"
    html = generador.generar_evaluacion(capa)
    assert '<img src=x onerror="alert(1)">' not in html and "onerror=&quot;" in html


def test_the_model_draft_is_validated_and_completed(monkeypatch):
    real_idx = {}

    def fake(empresa, giro, renglones, metricas, verdict, nivel, escala, ventajas):
        for r in renglones:
            n = int(r[1:r.index("]")])
            real_idx.setdefault("negocio" if "Negocio" in r else "cliente", []).append(n)
        return {
            "sintesis_titular": "Hoy el canal da servicio: saluda y canaliza.",
            "sintesis_texto": "Se vuelve experiencia cuando el cliente <script> resuelve y compra en el chat.",
            "fortalezas": [
                {"titulo": "Respuesta en 3 s", "texto": "Al instante, de día y de noche.", "mensaje": real_idx["negocio"][0]},
                {"titulo": "Menú que orienta y que además es muy largo de verdad", "texto": "Estacionario o servicio técnico.",
                 "mensaje": real_idx["cliente"][0]},  # pin en un mensaje del cliente: no vale para una fortaleza
            ],
            "oportunidades": [
                {"titulo": "La duda del tanque quedó abierta", "dato": "Sin respuesta", "vimos": "La pregunta de las 11:08 a.m. no tuvo respuesta.",
                 "oportunidad": "Resolver al momento las dudas frecuentes.", "mensaje": real_idx["cliente"][3], "ventaja": "b2"},
                {"titulo": "Fuera de horario, el cliente espera", "dato": "14 h de espera", "vimos": "Respondieron a las 9:13 a.m.",
                 "oportunidad": "Atender las 24 horas.", "mensaje": 999, "ventaja": "b2"},  # pin inexistente y ventaja repetida
            ],
        }
    monkeypatch.setattr(armador, "hallazgos_con_llm", fake)
    capa, info = _armar()
    assert info["origen"] == "llm"
    assert capa["nivel"]["sintesis"].startswith("<b>Hoy el canal da servicio: saluda y canaliza.</b> ")
    assert "&lt;script&gt;" in capa["nivel"]["sintesis"]
    assert len(capa["fortalezas"]) == 3 and len(capa["oportunidades"]) == 3
    assert len(capa["fortalezas"][1]["titulo"]) <= armador.LIMITES["f_titulo"] + 1  # recortado con "…"
    # La 2.ª repitió b2: se deduce b1 por su texto ("espera"), y la 3.ª (de reglas) no repite ese tema.
    assert capa["resuelve"] == {"b2": "1", "b1": "2", "b3": "3"}
    assert [o["dato"] for o in capa["oportunidades"]] == ["Sin respuesta", "14 h de espera", "Pedido por llamada"]
    pines = [m.get("pin") for m in capa["conversacion"]["real"] if m.get("pin")]
    assert len(pines) == len(set(pines))  # un pin por mensaje, sin repetir
    # Lo que el modelo marcó mal (fortaleza en un mensaje del cliente, mensaje 999) se avisa al revisor.
    assert sum("no corresponde" in a for a in info["avisos"]) == 2 and any("reglas" in a for a in info["avisos"])
    assert "v1" in pines and "1" in pines and "2" not in pines
    generador.generar_evaluacion(capa)


def test_two_findings_on_the_same_message_take_the_nearest_free_one():
    items = [{"tipo": "dia"}, {"tipo": "cliente"}, {"tipo": "negocio"}, {"tipo": "negocio"}, {"tipo": "cliente"}]
    hallazgos = {"oportunidades": [{"mensaje": 2}, {"mensaje": 2}], "fortalezas": [{"mensaje": 2}, {"mensaje": 4}]}
    avisos = armador.poner_pines(items, hallazgos)
    # La 2.ª oportunidad toma el siguiente mensaje libre; las fortalezas solo van en mensajes del
    # negocio y ya no queda ninguno libre: se avisa en lugar de marcar uno del cliente.
    assert [m.get("pin") for m in items] == [None, None, "1", "2", None] and len(avisos) == 2


def test_texts_that_do_not_fit_are_rewritten_shorter_instead_of_cut(monkeypatch):
    largo = "Escribimos el jueves 8 de octubre a las 6:42 p.m. y la primera respuesta humana llegó el viernes 9 a las 8:38 a.m., casi 14 horas después."
    draft = {"sintesis_titular": "Hoy el canal saluda y canaliza.", "sintesis_texto": "Falta vender en el chat.",
             "fortalezas": [{"titulo": "Pregunta la zona", "texto": "Confirma cobertura.", "mensaje": None}] * 3,
             "oportunidades": [{"titulo": "Espera de casi 14 horas", "dato": "14 h de espera", "vimos": largo,
                                "oportunidad": "Un asistente 24/7 responde, resuelve dudas y avanza el alta del cliente en la misma conversación.",
                                "mensaje": None, "ventaja": "b1"}]}
    pedidos = {}

    def acortar(excedidos):
        pedidos.update(excedidos)
        return {"o0.vimos": "Escribimos el jueves a las 6:42 p.m.; respondieron el viernes a las 8:38 a.m.",
                "o0.oportunidad": "x" * 200}  # esta tampoco cabe: se recorta y se avisa
    monkeypatch.setattr(armador, "hallazgos_con_llm", lambda *a, **k: draft)
    monkeypatch.setattr(armador, "acortar_con_llm", acortar)
    capa, info = _armar()
    assert set(pedidos) == {"o0.vimos", "o0.oportunidad"}
    assert capa["oportunidades"][0]["vimos"] == "Escribimos el jueves a las 6:42 p.m.; respondieron el viernes a las 8:38 a.m."
    assert capa["oportunidades"][0]["oportunidad"].endswith("…")
    assert any("se recortaron" in a for a in info["avisos"])


def test_labels_that_claim_a_fact_must_match_what_was_measured():
    metricas = {"sin_respuesta": [7], "telefonos": [], "esperas": [{"segundos": 13 * 3600 + 55 * 60}]}
    ops = [{"titulo": "Pregunta abierta", "dato": "Sin respuesta", "mensaje": 7},          # sí: el [7] quedó sin respuesta
           {"titulo": "Cobertura sin confirmar", "dato": "Sin respuesta", "mensaje": 9},   # no: ese sí se contestó
           {"titulo": "Pedido sin cierre", "dato": "Pedido por llamada", "mensaje": 9},     # no: nunca dieron teléfono
           {"titulo": "Espera nocturna", "dato": "14 h de espera", "mensaje": 9},           # sí: medido 13 h 55 min
           {"titulo": "Primera respuesta", "dato": "1492 h de espera", "mensaje": 9},       # no: no se midió
           {"titulo": "Sin cierre", "dato": "Sin cierre claro", "mensaje": 9}]              # etiqueta propia: se respeta
    avisos = armador.verificar_datos(ops, metricas)
    assert [o["dato"] for o in ops] == ["Sin respuesta", "", "", "14 h de espera", "", "Sin cierre claro"]
    assert len(avisos) == 3 and "Cobertura sin confirmar" in avisos[0]


def test_when_the_model_fails_the_rules_draft_is_used(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("sin crédito")
    monkeypatch.setattr(armador, "hallazgos_con_llm", boom)
    capa, info = _armar()
    assert info["origen"] == "reglas" and any("no respondió" in a for a in info["avisos"])
    generador.generar_evaluacion(capa)


@pytest.mark.parametrize("category,level", [("sin_respuesta", 1), ("automatico_sin_respuesta", 1), ("humano", 2),
                                            ("hibrido_automatico", 3), ("bot", 4), ("menu", 4)])
def test_levels_follow_the_classification(category, level):
    assert armador.nivel_desde({"category": category}, {})[0] == level


def test_first_response_counts_from_the_message_it_answers():
    # Gas de Tlalnepantla (2026-10-20): un "Hola" de agosto sin respuesta y, en octubre, su aviso
    # automático al instante. Medido desde agosto salían "1492 h" de primera respuesta.
    thread = [
        {"direction": "outbound", "body": "Hola", "created_at": "2026-08-07T20:01:00"},
        {"direction": "outbound", "body": "Hola", "created_at": "2026-10-09T00:41:00"},
        {"direction": "inbound", "body": "Gracias por tu mensaje.", "created_at": "2026-10-09T00:41:03"},
        {"direction": "outbound", "body": "¿Tienen estacionario?", "created_at": "2026-10-09T00:42:00"},
        {"direction": "inbound", "body": "Buenos días", "created_at": "2026-10-09T14:38:00"},
    ]
    _items, _renglones, metricas = armador.construir_conversacion(thread)
    assert metricas["primera_respuesta_s"] == 3
    assert [round(e["segundos"] / 3600, 1) for e in metricas["esperas"]] == [13.9]
    assert len(metricas["sin_respuesta"]) == 1


def test_no_answer_at_all_is_level_1_and_still_generates():
    thread = [t for t in _diesgas_thread() if t["direction"] == "outbound"][:2]
    capa, info = _armar(thread=thread, verdict={"category": "sin_respuesta"}, usar_llm=False)
    assert capa["nivel"]["hoy"] == 1 and capa["conversacion"]["real"][-1]["texto"] == "Sin respuesta en el chat"
    generador.generar_evaluacion(capa)


@pytest.mark.parametrize("url", ["http://127.0.0.1/logo.png", "http://10.0.1.2:27017/x.png", "http://169.254.169.254/latest",
                                 "ftp://example.com/x.png", "http://example.com:8080/x.png", "file:///etc/passwd",
                                 "http://[::1]/x.png", "http://192.168.1.10/logo.png"])
def test_logo_download_never_reaches_internal_addresses(url):
    assert not armador.url_publica(url)
    assert armador.logo_incrustado(url) is None
