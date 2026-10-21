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

    def fake(empresa, giro, renglones, metricas, verdict, nivel, escala, ventajas, hechos=None):
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
    # Lo que el modelo marcó mal (fortaleza en un mensaje del cliente, mensaje 999) y lo que faltó se avisa, en corto.
    assert any("no tienen su propio mensaje" in a for a in info["avisos"])
    assert any("2 hallazgo(s) sin redactar" in a for a in info["avisos"])
    assert "v1" in pines and "1" in pines and "2" not in pines
    assert len(info["avisos"]) <= 6
    generador.generar_evaluacion(capa)


def test_two_findings_on_the_same_message_take_the_nearest_free_one():
    items = [{"tipo": "dia"}, {"tipo": "cliente"}, {"tipo": "negocio"}, {"tipo": "negocio"}, {"tipo": "cliente"}]
    hallazgos = {"oportunidades": [{"mensaje": 2}, {"mensaje": 2}], "fortalezas": [{"mensaje": 2}, {"mensaje": 4}]}
    sin_lugar = armador.poner_pines(items, hallazgos)
    # La 2.ª oportunidad toma el siguiente mensaje libre; las fortalezas solo van en mensajes del
    # negocio y ya no queda ninguno libre: quedan sin marca en lugar de marcar uno del cliente.
    assert [m.get("pin") for m in items] == [None, None, "1", "2", None] and sin_lugar == ["v1", "v2"]


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
    quitadas = armador.verificar_datos(ops, metricas)
    assert [o["dato"] for o in ops] == ["Sin respuesta", "", "", "14 h de espera", "", "Sin cierre claro"]
    assert quitadas == ["Sin respuesta", "Pedido por llamada", "1492 h de espera"]


def _rayogas_thread():
    """Rayogas (2026-10-20): un solo mensaje nuestro y su bienvenida automática con aviso de privacidad."""
    return [
        {"direction": "outbound", "body": "Hola ¿cómo están? Soy Angie. ¿Me podrían ayudar con el contacto indicado?",
         "created_at": "2026-10-14T20:13:00"},
        {"direction": "inbound", "body": "Hola! 👋 Bienvenido(a) a Rayogas. Antes de continuar es necesario contar con su "
                                         "autorización para el tratamiento de datos personales.",
         "created_at": "2026-10-14T20:13:04"},
    ]


def test_a_short_chat_with_only_an_automatic_reply_is_read_correctly():
    capa, info = armador.armar_cliente(company={"name": "Rayogas"}, thread=_rayogas_thread(), numero="573102388245",
                                       verdict=None, industria="gaseras", usar_llm=False, bajar_logo=lambda u: None,
                                       ahora=datetime(2026, 10, 20, tzinfo=timezone.utc))
    tipos = [h["tipo"] for h in info["hechos"]["oportunidades"]]
    assert tipos[:2] == ["solo_automatico", "privacidad"]
    assert capa["nivel"]["hoy"] == 1  # solo el automático, como "Automático + sin respuesta"
    assert capa["nivel"]["clasificacion"] == "automatico_sin_respuesta"
    assert capa["nivel"]["nombreHoy"] == "Automático + sin respuesta"  # bajo "Nivel 1 de 5", el nombre de Análisis
    assert [o["dato"] for o in capa["oportunidades"]] == ["Solo automático", "Trámite al inicio", "Sin pedido en chat"]
    assert capa["cliente"]["telefono"] == "+57 310 238 8245"
    assert [f["titulo"] for f in capa["fortalezas"]][:2] == ["Respuesta en 4 s", "Bienvenida clara"]
    assert capa["fortalezas"][0]["texto"] == "Mensaje automático al instante."
    assert any(a.startswith("Conversación corta (2 mensajes)") for a in info["avisos"])
    assert any("se estimó" in a for a in info["avisos"]) and len(info["avisos"]) <= 5
    generador.generar_evaluacion(capa)


def test_the_model_only_writes_the_facts_it_cites(monkeypatch):
    def fake(empresa, giro, renglones, metricas, verdict, nivel, escala, ventajas, hechos):
        ids = {h["tipo"]: h["id"] for h in hechos["oportunidades"]}
        return {"sintesis_titular": "El canal saluda, pero no atiende.", "sintesis_texto": "Falta atender y tomar el pedido.",
                "fortalezas": [{"hecho": "F2", "titulo": "Bienvenida", "texto": "Saluda con su marca."}],
                "oportunidades": [
                    # El modelo intenta poner otra etiqueta y otro mensaje: mandan los del hecho.
                    {"hecho": ids["solo_automatico"], "titulo": "Nadie atendió", "dato": "Sin respuesta", "mensaje": 0,
                     "vimos": "Solo llegó el automático.", "oportunidad": "Atender a toda hora.", "ventaja": "b7"},
                    {"hecho": ids["solo_automatico"], "titulo": "Repetido", "vimos": "x", "oportunidad": "y"},  # mismo hecho otra vez
                ]}
    monkeypatch.setattr(armador, "hallazgos_con_llm", fake)
    capa, info = armador.armar_cliente(company={"name": "Rayogas"}, thread=_rayogas_thread(), numero="573102388245",
                                       verdict=None, industria="gaseras", bajar_logo=lambda u: None)
    o1 = capa["oportunidades"][0]
    assert (o1["titulo"], o1["dato"]) == ("Nadie atendió", "Solo automático")
    assert capa["resuelve"]["b1"] == "1" and "b7" not in capa["resuelve"]  # la del hecho (24/7), no la que propuso
    pin_o1 = next(i for i, m in enumerate(capa["conversacion"]["real"]) if m.get("pin") == "1")
    assert capa["conversacion"]["real"][pin_o1]["tipo"] == "negocio"  # el mensaje del hecho, no el 0 que dijo el modelo
    # El repetido no cita un hecho válido: queda como propio y sin etiqueta inventada.
    assert capa["oportunidades"][1]["titulo"] == "Repetido" and capa["oportunidades"][1]["dato"] == ""
    generador.generar_evaluacion(capa)


def test_a_cited_fact_keeps_its_curated_remedy_and_is_never_cut(monkeypatch):
    # Diesgas, 2026-10-20: el modelo comprimía "la oportunidad" hasta dejarla cortada con "…".
    def fake(empresa, giro, renglones, metricas, verdict, nivel, escala, ventajas, hechos):
        ids = {h["tipo"]: h["id"] for h in hechos["oportunidades"]}
        return {"sintesis_titular": "Canal activo, pero sin cierre.", "sintesis_texto": "Falta tomar el pedido en el chat.",
                "fortalezas": [{"hecho": "F1", "titulo": "Responde rápido y con un mensaje muy completo", "texto": "Al instante."}],
                "oportunidades": [{"hecho": ids["espera"], "titulo": "Espera de catorce horas",
                                   "vimos": "Escribimos por la tarde y la primera respuesta humana llegó hasta la mañana del "
                                            "día siguiente, casi catorce horas después, sin ningún aviso intermedio.",
                                   "oportunidad": "Respuesta automática con horario y pronta atención"}]}
    monkeypatch.setattr(armador, "hallazgos_con_llm", fake)
    monkeypatch.setattr(armador, "acortar_con_llm", lambda excedidos: {})  # la segunda pasada tampoco lo logra
    capa, info = _armar()
    hecho = next(h for h in info["hechos"]["oportunidades"] if h["tipo"] == "espera")
    o1 = capa["oportunidades"][0]
    assert o1["titulo"] == "Espera de catorce horas"            # lo que cabe se queda como lo escribió
    assert o1["oportunidad"] == hecho["oportunidad"]            # el remedio curado del hecho
    assert o1["vimos"] == hecho["vimos"] and "…" not in o1["vimos"]  # no cupo: el del hecho, no cortado
    assert capa["fortalezas"][0]["titulo"] == info["hechos"]["fortalezas"][0]["titulo"]
    assert not any("se recortaron" in a for a in info["avisos"])
    generador.generar_evaluacion(capa)


def test_the_six_analytics_classifications_and_their_level():
    # Los mismos nombres que la columna Resultado de Análisis; un bot con IA es "Agente IA".
    casos = {("bot", True): "agente_ia", ("menu", True): "agente_ia", ("bot", False): "bot", ("hibrido_bot", True): "bot",
             ("hibrido", False): "bot", ("hibrido_automatico", False): "automatico", ("automatico", False): "automatico",
             ("automatico_sin_respuesta", False): "automatico_sin_respuesta", ("humano", False): "humano",
             ("sin_respuesta", False): "sin_respuesta", ("pendiente", False): None, (None, False): None}
    for (categoria, ia), esperada in casos.items():
        assert armador.clasificacion_de({"category": categoria, "is_ai": ia}) == esperada, categoria
    assert {k: v[1] for k, v in armador.CLASIFICACIONES.items()} == {
        "sin_respuesta": 1, "automatico_sin_respuesta": 1, "humano": 2, "automatico": 3, "bot": 4, "agente_ia": 4}
    # Sin clasificación: se deduce de la conversación.
    sin = {"humanos": 0, "automaticos": 0}
    assert armador.clasificacion_desde(None, {}, sin) == ("sin_respuesta", "reglas")
    assert armador.clasificacion_desde(None, {}, {**sin, "automaticos": 1}) == ("automatico_sin_respuesta", "reglas")
    assert armador.clasificacion_desde(None, {}, {"humanos": 2, "automaticos": 1}) == ("automatico", "reglas")
    assert armador.clasificacion_desde({"category": "bot", "is_ai": True}, {}, sin) == ("agente_ia", "clasificacion")


def _chat(*mensajes):
    """[(dirección, texto, minutos desde el inicio)] como filas de get_conversation_thread."""
    inicio = datetime(2026, 10, 1, 17, 0)
    return [{"direction": d, "body": t, "created_at": (inicio + timedelta(minutes=m)).isoformat()} for d, t, m in mensajes]


def test_a_bot_is_never_praised_as_a_person_attending(monkeypatch):
    # Taboo Restaurant, 2026-10-21: Análisis decía «Bot» y la página, «Trato personal: una persona atiende».
    monkeypatch.setattr(armador, "hallazgos_con_llm", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("sin IA")))
    chat = _chat(("outbound", "Hola, ¿hacen envíos?", 0),
                 ("inbound", "Puede hablar con el restaurante enviando un WhatsApp al +52 998 410 5991. ¡Muchas gracias!", 1))
    for categoria, persona in (("bot", False), ("automatico", True), ("humano", True)):
        _capa, info = _armar(chat, {"category": categoria})
        tipos = [f["tipo"] for f in info["hechos"]["fortalezas"]]
        assert ("trato_personal" in tipos) == persona, categoria
        assert [f["id"] for f in info["hechos"]["fortalezas"]] == [f"F{k}" for k in range(1, len(tipos) + 1)]


def test_whatsapp_menus_show_as_buttons_under_the_message():
    texto, opciones = armador.separar_opciones("¿En qué te ayudo?\n[Opciones: Ubicación | Horario | Asesor]")
    assert (texto, opciones) == ("¿En qué te ayudo?", ["Ubicación", "Horario", "Asesor"])
    assert armador.separar_opciones("Sin menú [no es lista]") == ("Sin menú [no es lista]", [])
    items, _renglones, metricas = armador.construir_conversacion(_chat(
        ("outbound", "Hola", 0), ("inbound", "\n[Lista: Español | English]", 1), ("inbound", "Bienvenido", 2)))
    burbujas = [i for i in items if i["tipo"] in ("cliente", "negocio")]
    assert burbujas[1]["texto"] == "📋 Menú de opciones"
    assert {"tipo": "opciones", "opciones": ["Español", "English"]} in items
    assert "[Lista" not in json.dumps(items, ensure_ascii=False)
    assert all(items[d["i"]]["tipo"] in ("cliente", "negocio") for d in metricas["detalle"])  # los índices siguen apuntando al mensaje


def test_the_page_never_speaks_to_the_business_as_tu(monkeypatch):
    # Rayogas, 2026-10-20: "Saluda con tu marca" aunque el prompt pide tercera persona.
    def fake(empresa, giro, renglones, metricas, verdict, nivel, escala, ventajas, hechos):
        ids = {h["tipo"]: h["id"] for h in hechos["fortalezas"]}
        return {"sintesis_titular": "Tu canal saluda, pero no vende.", "sintesis_texto": "Falta tomar el pedido en el chat.",
                "fortalezas": [{"hecho": ids["bienvenida"], "titulo": "Bienvenida clara", "texto": "Saluda con tu marca."},
                               {"hecho": ids["respuesta_rapida"], "titulo": "Respuesta al instante", "texto": "Contesta en segundos."}],
                "oportunidades": []}
    monkeypatch.setattr(armador, "hallazgos_con_llm", fake)
    capa, info = _armar()
    bienvenida = next(h for h in info["hechos"]["fortalezas"] if h["tipo"] == "bienvenida")
    assert capa["fortalezas"][0] == {"titulo": "Bienvenida clara", "texto": bienvenida["texto"]}  # "Saluda con su marca."
    assert capa["fortalezas"][1]["texto"] == "Contesta en segundos."  # lo que está bien escrito se respeta
    assert not capa["nivel"]["sintesis"].startswith("<b>Tu ")  # la síntesis vuelve a la de su nivel
    assert "Falta tomar el pedido en el chat." in capa["nivel"]["sintesis"]


def test_the_chat_profile_picture_is_the_whole_logo_centered():
    import base64
    import io
    from PIL import Image
    ancho = Image.new("RGBA", (300, 100), (255, 0, 0, 255))  # logo ancho, como el de Rayogas
    buf = io.BytesIO()
    ancho.save(buf, "PNG")
    logo = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    avatar = armador.avatar_de_logo(logo)
    img = Image.open(io.BytesIO(base64.b64decode(avatar.split(",", 1)[1]))).convert("RGB")
    assert img.size == (192, 192)
    # Entero dentro del círculo: rojo al centro y en los extremos del logo, blanco en las esquinas.
    assert img.getpixel((96, 96)) == (255, 0, 0) and img.getpixel((20, 96)) == (255, 0, 0)
    assert img.getpixel((5, 5)) == (255, 255, 255) and img.getpixel((96, 20)) == (255, 255, 255)
    assert armador.avatar_de_logo("data:image/png;base64,bm8gZXMgdW5hIGltYWdlbg==") is None  # no es imagen
    cliente = {"nombre": "X"}
    armador.poner_logo(cliente, logo)
    assert cliente["logo"] == logo and cliente["avatar"] == avatar
    armador.poner_logo(cliente, None)
    assert cliente == {"nombre": "X"}


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
