"""Endpoints de la evaluación: arma el borrador desde la conversación guardada, se edita sin
aceptar HTML, la liga pública no pide sesión y las demás rutas sí."""
import re
from datetime import datetime

import pytest
from bson import ObjectId
from fastapi.testclient import TestClient

from app.api import evaluaciones
from app.database import MongoDBManager
from tests.test_evaluacion_armador import _diesgas_thread

NUMERO = "5213311171010"


@pytest.fixture
def client(monkeypatch):
    from app.main import app
    db = MongoDBManager()
    for name in ("companies", "message_logs", "evaluaciones", "classification_comparisons", "contacts"):
        db.db[name].delete_many({})
    cid = ObjectId()
    db.db.companies.insert_one({"_id": cid, "name": "Diesgas", "industry": "Gas LP / Energía", "logo_url": None})
    for m in _diesgas_thread():
        sale = m["direction"] == "outbound"
        db.db.message_logs.insert_one({
            "company_id": str(cid), "direction": m["direction"], "message_body": m["body"],
            "created_at": datetime.fromisoformat(m["created_at"]), "status": "sent" if sale else "received",
            **({"to_number": NUMERO} if sale else {"from_number": NUMERO, "related_to_number": NUMERO})})
    db.db.classification_comparisons.insert_one({"company_id": str(cid), "hibrido": {"category": "automatico"}})
    monkeypatch.setattr(evaluaciones, "_usuario", lambda token: {"username": "qa"} if token == "ok" else
                        (_ for _ in ()).throw(evaluaciones.HTTPException(401, "Sesión inválida o expirada")))
    return TestClient(app), str(cid)


H = {"x-user-token": "ok"}


def test_full_flow_draft_preview_edit_and_public_link(client):
    c, cid = client
    r = c.post("/api/evaluaciones", json={"company_id": cid, "usar_llm": False}, headers=H)
    assert r.status_code == 200, r.text
    ev = r.json()
    assert ev["numero"] == NUMERO and ev["industria"] == "gaseras" and ev["editable"]["nivel"] == 3
    assert ev["escala"][2] == "Automático + humano" and {"id": "b1", "titulo": "Atención 24/7"} in ev["ventajas"]
    assert [o["dato"] for o in ev["editable"]["oportunidades"]] == ["Sin respuesta", "14 h de espera", "Pedido por llamada"]

    vista = c.get(f"/api/evaluaciones/{ev['id']}/html", headers=H)
    assert vista.status_code == 200 and "Evaluación del canal WhatsApp de Diesgas" in vista.text

    pines = ev["editable"]["pines"]
    edicion = {"sintesis_titular": "Hoy el canal <script>alert(1)</script> saluda.", "nivel": 2,
               "fortalezas": [{"titulo": "Respuesta en 3 s", "texto": "Al instante."}],
               "pines": {"v1": pines["v1"], "1": pines["1"]}}
    r = c.put(f"/api/evaluaciones/{ev['id']}", json=edicion, headers=H)
    assert r.status_code == 200, r.text
    ed = r.json()["editable"]
    assert ed["nivel"] == 2 and ed["sintesis_titular"] == "Hoy el canal <script>alert(1)</script> saluda."
    guardado = MongoDBManager().db.evaluaciones.find_one({"_id": ObjectId(ev["id"])})
    assert "&lt;script&gt;" in guardado["cliente"]["nivel"]["sintesis"]  # en la página va escapado
    assert ed["pines"] == {"v1": pines["v1"], "1": pines["1"]}

    publica = c.get(f"/api/evaluaciones/publica/{ev['token']}")  # sin sesión
    assert publica.status_code == 200 and publica.headers["x-robots-tag"] == "noindex, nofollow"
    assert "<script>alert(1)</script>" not in publica.text
    assert c.get("/api/evaluaciones/publica/no-existe-esta-liga-xx").status_code == 404

    listado = c.get(f"/api/evaluaciones?company_id={cid}", headers=H).json()["items"]
    assert [e["id"] for e in listado] == [ev["id"]]


def test_edits_cannot_break_the_page(client):
    c, cid = client
    ev = c.post("/api/evaluaciones", json={"company_id": cid, "usar_llm": False}, headers=H).json()
    pines = ev["editable"]["pines"]
    # Un pin a un mensaje que no existe, o dos marcas en el mismo mensaje.
    assert c.put(f"/api/evaluaciones/{ev['id']}", json={"pines": {"1": 999}}, headers=H).status_code == 422
    assert c.put(f"/api/evaluaciones/{ev['id']}", json={"pines": {"1": pines["v1"], "v1": pines["v1"]}}, headers=H).status_code == 422
    # Se quita la 3.ª oportunidad pero su marca sigue en el chat: el generador lo detecta.
    assert "3" in pines
    dos = ev["editable"]["oportunidades"][:2]
    r = c.put(f"/api/evaluaciones/{ev['id']}", json={"oportunidades": dos}, headers=H)
    assert r.status_code == 422 and "sin oportunidad" in r.text
    assert c.put(f"/api/evaluaciones/{ev['id']}", json={"oportunidades": []}, headers=H).status_code == 422  # mínimo una
    assert c.put(f"/api/evaluaciones/{ev['id']}", json={"oportunidades": dos * 2}, headers=H).status_code == 422  # la hoja da para 3
    assert c.put(f"/api/evaluaciones/{ev['id']}", json={"nivel": 5}, headers=H).status_code == 422  # 5 es la meta


def test_opportunities_can_be_removed_and_reordered_with_their_marks(client):
    c, cid = client
    ev = c.post("/api/evaluaciones", json={"company_id": cid, "usar_llm": False}, headers=H).json()
    o, pines = ev["editable"]["oportunidades"], ev["editable"]["pines"]
    # Como lo manda el editor: se quita la 1.ª y las otras suben, con sus marcas y ventajas renumeradas.
    r = c.put(f"/api/evaluaciones/{ev['id']}", headers=H, json={
        "oportunidades": [o[2], o[1]], "pines": {"1": pines["3"], "2": pines["2"], "v1": pines["v1"]},
        "resuelve": {"b3": "1", "b1": "2"}})
    assert r.status_code == 200, r.text
    ed = r.json()["editable"]
    assert [x["dato"] for x in ed["oportunidades"]] == ["Pedido por llamada", "14 h de espera"]
    assert ed["pines"] == {"1": pines["3"], "2": pines["2"], "v1": pines["v1"]} and ed["resuelve"] == {"b3": "1", "b1": "2"}
    assert c.get(f"/api/evaluaciones/{ev['id']}/html", headers=H).status_code == 200


def test_the_logo_can_be_replaced_or_removed_but_only_with_real_images(client):
    import base64
    import struct
    import zlib
    c, cid = client
    ev = c.post("/api/evaluaciones", json={"company_id": cid, "usar_llm": False}, headers=H).json()

    def png(w=2, h=2):
        crc = lambda tag, data: struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)  # noqa: E731
        chunk = lambda tag, data: struct.pack(">I", len(data)) + tag + data + crc(tag, data)  # noqa: E731
        raw = b"".join(b"\x00" + b"\xff\x00\x00" * w for _ in range(h))
        return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
    real = "data:image/png;base64," + base64.b64encode(png()).decode()
    r = c.put(f"/api/evaluaciones/{ev['id']}", json={"logo_data": real}, headers=H)
    assert r.status_code == 200 and r.json()["editable"]["logo"] == real
    guardado = MongoDBManager().db.evaluaciones.find_one({"_id": ObjectId(ev["id"])})["cliente"]["cliente"]
    assert guardado["avatar"].startswith("data:image/png;base64,")  # el logo también es la foto de perfil del chat
    falso = "data:image/png;base64," + base64.b64encode(b"<svg onload=alert(1)>").decode()
    assert c.put(f"/api/evaluaciones/{ev['id']}", json={"logo_data": falso}, headers=H).status_code == 422
    assert c.put(f"/api/evaluaciones/{ev['id']}", json={"logo_data": "data:image/svg+xml;base64,PHN2Zz4="}, headers=H).status_code == 422
    assert c.put(f"/api/evaluaciones/{ev['id']}", json={"logo_url": "http://10.0.1.2/logo.png"}, headers=H).status_code == 422
    r = c.put(f"/api/evaluaciones/{ev['id']}", json={"quitar_logo": True}, headers=H)
    assert r.status_code == 200 and r.json()["editable"]["logo"] is None
    guardado = MongoDBManager().db.evaluaciones.find_one({"_id": ObjectId(ev["id"])})["cliente"]["cliente"]
    assert "avatar" not in guardado  # sin logo, el chat muestra las iniciales
    pagina = c.get(f"/api/evaluaciones/{ev['id']}/html", headers=H).text
    datos_cliente = pagina.split('"cliente":', 1)[1].split("}", 1)[0]
    assert '"logo"' not in datos_cliente and '"nombre":"Diesgas"' in datos_cliente  # sin logo: se muestra el nombre


def test_live_preview_shows_unsaved_changes_and_saves_nothing(client):
    c, cid = client
    ev = c.post("/api/evaluaciones", json={"company_id": cid, "usar_llm": False}, headers=H).json()
    r = c.post(f"/api/evaluaciones/{ev['id']}/vista-previa", json={"sintesis_titular": "Vista previa sin guardar", "nivel": 2}, headers=H)
    assert r.status_code == 200 and "Vista previa sin guardar" in r.text
    guardado = c.get(f"/api/evaluaciones/{ev['id']}", headers=H).json()["editable"]
    assert guardado["sintesis_titular"] != "Vista previa sin guardar" and guardado["nivel"] == 3
    assert c.post(f"/api/evaluaciones/{ev['id']}/vista-previa", json={"pines": {"1": 999}}, headers=H).status_code == 422
    assert c.post(f"/api/evaluaciones/{ev['id']}/vista-previa", json={}).status_code == 401
    # Para elegir "Se ve en": cada mensaje en texto plano, y los hechos detectados para el editor.
    negocio = next(m for m in ev["conversacion"] if m["tipo"] == "negocio")
    assert negocio["resumen"] and "<" not in negocio["resumen"]
    assert ev["info"]["hechos"]["oportunidades"][0]["tipo"] == "sin_respuesta"


def test_the_level_is_the_one_analytics_shows_even_for_a_single_number_company(client, monkeypatch):
    # Rayogas (2026-10-20): un solo número, Timing + IA guardado solo a nivel empresa ("bot").
    c, cid = client
    db = MongoDBManager()
    db.db.classification_comparisons.delete_many({})
    db.db.classification_comparisons.insert_one({"company_id": cid, "hibrido": {"category": "bot", "notes": "Menú con opciones"}, "numbers": []})
    monkeypatch.setattr(evaluaciones, "_elegir_numero", lambda db, cid, pedido: {"number": NUMERO, "category": "bot", "is_ai": False})
    ev = c.post("/api/evaluaciones", json={"company_id": cid, "usar_llm": False}, headers=H).json()
    assert ev["info"]["nivel_fuente"] == "clasificacion" and ev["info"]["categoria"] == "bot"
    assert ev["editable"]["nivel"] == 4 and ev["info"]["nivel_analisis"] == 4
    assert not any("se estimó" in a for a in ev["info"]["avisos"])


def test_the_exact_classification_is_shown_and_can_be_changed(client):
    c, cid = client
    ev = c.post("/api/evaluaciones", json={"company_id": cid, "usar_llm": False}, headers=H).json()
    assert ev["editable"]["clasificacion"] == "automatico" and ev["info"]["clasificacion_analisis"] == "automatico"
    assert {"id": "agente_ia", "nombre": "Agente IA", "nivel": 4} in ev["clasificaciones"]
    r = c.put(f"/api/evaluaciones/{ev['id']}", json={"clasificacion": "agente_ia"}, headers=H)
    assert r.status_code == 200 and r.json()["editable"]["nivel"] == 4 and r.json()["editable"]["clasificacion"] == "agente_ia"
    pagina = c.get(f"/api/evaluaciones/{ev['id']}/html", headers=H).text
    assert '"nombreHoy":"Agente IA"' in pagina  # bajo "Nivel 4 de 5"; la barra sigue con "Bot de atención"
    assert c.put(f"/api/evaluaciones/{ev['id']}", json={"clasificacion": "pendiente"}, headers=H).status_code == 422
    # El editor anterior mandaba solo el nivel: si ya no cae en la clasificación, va el nombre genérico.
    r = c.put(f"/api/evaluaciones/{ev['id']}", json={"nivel": 2}, headers=H)
    assert r.json()["editable"]["nivel"] == 2 and r.json()["editable"]["clasificacion"] is None
    assert '"nombreHoy"' not in c.get(f"/api/evaluaciones/{ev['id']}/html", headers=H).text


def test_pdf_download_for_sharing(client, monkeypatch):
    c, cid = client
    ev = c.post("/api/evaluaciones", json={"company_id": cid, "usar_llm": False}, headers=H).json()
    vistas = []
    monkeypatch.setattr(evaluaciones, "_pdf", lambda pagina: vistas.append(pagina) or b"%PDF-1.7 prueba")
    r = c.get(f"/api/evaluaciones/{ev['id']}/pdf", headers=H)
    assert r.status_code == 200 and r.content == b"%PDF-1.7 prueba" and r.headers["content-type"] == "application/pdf"
    assert r.headers["content-disposition"] == 'attachment; filename="evaluacion-whatsapp-Diesgas.pdf"'
    assert "Evaluación del canal WhatsApp de Diesgas" in vistas[0]  # el PDF es de lo guardado
    assert c.get(f"/api/evaluaciones/{ev['id']}/pdf").status_code == 401

    def falla(pagina):
        raise RuntimeError("sin chromium")
    monkeypatch.setattr(evaluaciones, "_pdf", falla)
    r = c.get(f"/api/evaluaciones/{ev['id']}/pdf", headers=H)
    assert r.status_code == 503 and "descarga el HTML" in r.json()["detail"]


def test_pdf_is_two_letter_pages_rendered_offline():
    pytest.importorskip("playwright")
    from app.evaluacion import generador
    from tests.test_evaluacion import FX, _cfg
    try:
        pdf = evaluaciones._pdf(generador.generar_evaluacion(_cfg("diesgas"), raices_assets=[FX]))
    except Exception as exc:  # CI sin Chromium instalado
        pytest.skip(f"Chromium no disponible: {exc}")
    assert pdf.startswith(b"%PDF")
    assert len(re.findall(rb"/Type\s*/Page(?!s)", pdf)) == 2  # hoy y con De Tu Cel
    assert b"[0 0 612 792]" in pdf  # carta: 8.5 × 11 in


def test_session_is_required_except_for_the_public_link(client):
    c, cid = client
    assert c.post("/api/evaluaciones", json={"company_id": cid}).status_code == 401
    assert c.get(f"/api/evaluaciones?company_id={cid}").status_code == 401


def test_unknown_industry_asks_which_template(client):
    c, cid = client
    MongoDBManager().db.companies.update_one({"_id": ObjectId(cid)}, {"$set": {"industry": "Panadería", "name": "Pan Rico"}})
    r = c.post("/api/evaluaciones", json={"company_id": cid, "usar_llm": False}, headers=H)
    assert r.status_code == 422 and r.json()["detail"]["opciones"] == ["gaseras", "restaurantes"]
    assert r.json()["detail"]["etiquetas"] == {"gaseras": "Gaseras", "restaurantes": "Restaurantes"}
    assert "Todavía no hay plantilla para «Panadería»" in r.json()["detail"]["message"]
    # Un restaurante ya no pregunta: "Alimentos y Bebidas" es el giro con más empresas.
    MongoDBManager().db.companies.update_one({"_id": ObjectId(cid)}, {"$set": {"industry": "Alimentos y Bebidas", "name": "Taquería Los Güeros"}})
    r = c.post("/api/evaluaciones", json={"company_id": cid, "usar_llm": False}, headers=H)
    assert r.status_code == 200 and r.json()["industria"] == "restaurantes"
    MongoDBManager().db.companies.update_one({"_id": ObjectId(cid)}, {"$set": {"industry": "Panadería", "name": "Pan Rico"}})
    r = c.post("/api/evaluaciones", json={"company_id": cid, "usar_llm": False, "industria": "gaseras"}, headers=H)
    assert r.status_code == 200
