"""Evaluación del canal WhatsApp (one-pager para el prospecto).

POST /api/evaluaciones                 arma un borrador desde la conversación y el análisis
GET  /api/evaluaciones?company_id=     evaluaciones de una empresa (más reciente primero)
GET  /api/evaluaciones/{id}            el borrador con sus campos editables
PUT  /api/evaluaciones/{id}            guarda lo que corrigió una persona (solo campos de texto)
GET  /api/evaluaciones/{id}/html       la página, para vista previa o descarga
GET  /api/evaluaciones/publica/{token} la página para el prospecto, sin sesión (liga por WhatsApp)

El borrador lo escribe el modelo sobre la conversación real; lo que llega al prospecto lo
revisa una persona. Las ediciones nunca aceptan HTML: los textos se escapan y la síntesis se
arma con nuestras propias <b>.
"""
import copy
import html
import logging
import re
import secrets
import threading
import unicodedata
from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, Field

from app.database import MongoDBManager
from app.evaluacion import armador, formato, generador

log = logging.getLogger(__name__)
router = APIRouter()
COLECCION = "evaluaciones"


def _usuario(token):
    from app.api.routes import _require_user
    return _require_user(token)


def _col(db):
    col = db.db[COLECCION]
    if not getattr(_col, "_indices", False):
        try:
            col.create_index("token", unique=True)
            col.create_index([("company_id", 1), ("created_at", -1)])
            _col._indices = True
        except Exception:
            log.exception("evaluaciones: no se pudieron crear índices")
    return col


def _oid(evaluacion_id: str) -> ObjectId:
    try:
        return ObjectId(evaluacion_id)
    except Exception:
        raise HTTPException(404, "Evaluación no encontrada")


def _resumen(doc: dict, completo: bool = False) -> dict:
    out = {"id": str(doc["_id"]), "token": doc["token"], "company_id": doc["company_id"],
           "company_name": doc.get("company_name"), "numero": doc.get("numero"), "industria": doc.get("industria"),
           "info": doc.get("info", {}), "created_by": doc.get("created_by"),
           "created_at": doc.get("created_at"), "updated_at": doc.get("updated_at")}
    if completo:
        giro = generador.leer_json(generador.RAIZ / "config" / "industrias" / f"{doc['industria']}.json")
        out["ventajas"] = [{"id": v["id"], "titulo": v["titulo"]} for v in giro.get("ventajas", []) if not v.get("destacada")]
        out["escala"] = [n["nombre"] for n in generador.leer_json(generador.RAIZ / "config" / "base.json")["nivel"]["escala"]]
        out["editable"] = _editable(doc["cliente"])
        out["limites"] = dict(armador.LIMITES)
        # Las 6 clasificaciones de Análisis con su nivel: el editor elige una y el nivel sale solo.
        out["clasificaciones"] = [{"id": k, "nombre": n, "nivel": nv} for k, (n, nv) in armador.CLASIFICACIONES.items()]
        info = out["info"] = dict(out["info"])
        if "clasificacion_analisis" not in info and info.get("nivel_fuente") == "clasificacion":  # evaluaciones anteriores
            info["clasificacion_analisis"] = armador.clasificacion_de({"category": info.get("categoria"), "is_ai": info.get("es_ia")})
        # Para elegir "Se ve en": cada mensaje en texto plano y corto (el HTML del chat ya va escapado).
        out["conversacion"] = [{"i": i, "tipo": m.get("tipo"), "hora": m.get("hora", ""), "pin": m.get("pin"),
                                "resumen": formato.texto_plano(html.unescape(re.sub(r"<[^>]+>", " ", m.get("texto") or "")), 70)}
                               for i, m in enumerate(doc["cliente"]["conversacion"]["real"])]
    return out


def _editable(capa: dict) -> dict:
    """Lo que la persona puede corregir, en texto plano."""
    sintesis = capa["nivel"].get("sintesis", "")
    m = re.match(r"^<b>(.*?)</b>\s*(.*)$", sintesis, re.S)
    titular, texto = (m.group(1), m.group(2)) if m else ("", sintesis)
    return {
        "nombre": capa["cliente"].get("nombre", ""), "nombreBot": capa["cliente"].get("nombreBot", ""),
        "telefono": capa["cliente"].get("telefono", ""), "logo": capa["cliente"].get("logo"),
        "nivel": capa["nivel"]["hoy"], "clasificacion": capa["nivel"].get("clasificacion"),
        "sintesis_titular": html.unescape(titular), "sintesis_texto": html.unescape(texto),
        "fortalezas": copy.deepcopy(capa.get("fortalezas", [])),
        "oportunidades": copy.deepcopy(capa.get("oportunidades", [])),
        "resuelve": dict(capa.get("resuelve", {})),
        "pines": {m["pin"]: i for i, m in enumerate(capa["conversacion"]["real"]) if m.get("pin")},
    }


# Los mismos topes que el borrador (armador.LIMITES): con ellos la hoja carta siempre cabe.
_L = armador.LIMITES


class Fortaleza(BaseModel):
    titulo: str = Field(max_length=_L["f_titulo"])
    texto: str = Field("", max_length=_L["f_texto"])


class Oportunidad(BaseModel):
    titulo: str = Field(max_length=_L["o_titulo"])
    dato: str = Field("", max_length=_L["o_dato"])
    vimos: str = Field("", max_length=_L["o_vimos"])
    oportunidad: str = Field("", max_length=_L["o_oportunidad"])


class Edicion(BaseModel):
    nombre: Optional[str] = Field(None, max_length=80)
    nombreBot: Optional[str] = Field(None, max_length=60)
    telefono: Optional[str] = Field(None, max_length=30)
    nivel: Optional[int] = Field(None, ge=1, le=4)
    clasificacion: Optional[str] = Field(None, max_length=40)  # una de armador.CLASIFICACIONES; manda sobre "nivel"
    sintesis_titular: Optional[str] = Field(None, max_length=_L["sintesis_titular"])
    sintesis_texto: Optional[str] = Field(None, max_length=_L["sintesis_texto"])
    fortalezas: Optional[list[Fortaleza]] = Field(None, max_length=3)
    oportunidades: Optional[list[Oportunidad]] = Field(None, min_length=1, max_length=3)  # la hoja carta da para 3
    resuelve: Optional[dict[str, str]] = None
    pines: Optional[dict[str, int]] = None  # {"1": índice del mensaje, "v2": …}
    # Logo: quitarlo (se muestra el nombre), subir uno (data URL) o tomarlo de una URL pública.
    quitar_logo: bool = False
    logo_data: Optional[str] = Field(None, max_length=1_400_000)
    logo_url: Optional[str] = Field(None, max_length=2000)


def aplicar_edicion(capa: dict, e: Edicion) -> dict:
    capa = copy.deepcopy(capa)
    plano = formato.texto_plano
    for campo in ("nombre", "nombreBot", "telefono"):
        if getattr(e, campo) is not None:
            capa["cliente"][campo] = plano(getattr(e, campo))
            if campo == "nombre":
                capa["cliente"]["logoAlt"] = plano(e.nombre)
    if e.quitar_logo:
        armador.poner_logo(capa["cliente"], None)
    elif e.logo_data:
        try:
            armador.poner_logo(capa["cliente"], armador.logo_subido(e.logo_data))
        except ValueError as exc:
            raise HTTPException(422, str(exc))
    elif e.logo_url:
        logo = armador.logo_incrustado(e.logo_url.strip())
        if not logo:
            raise HTTPException(422, "No se pudo usar esa URL: debe ser una imagen PNG, JPG o WEBP pública.")
        armador.poner_logo(capa["cliente"], logo)
    if e.clasificacion is not None:
        if e.clasificacion not in armador.CLASIFICACIONES:
            raise HTTPException(422, "Clasificación desconocida")
        nombre, nivel = armador.CLASIFICACIONES[e.clasificacion]
        capa["nivel"].update({"hoy": nivel, "clasificacion": e.clasificacion, "nombreHoy": nombre})
    elif e.nivel is not None:
        capa["nivel"]["hoy"] = e.nivel
        # Solo el nivel: si la clasificación guardada ya no cae en él, va el nombre genérico del nivel.
        if armador.CLASIFICACIONES.get(capa["nivel"].get("clasificacion"), ("", 0))[1] != e.nivel:
            capa["nivel"].pop("clasificacion", None)
            capa["nivel"].pop("nombreHoy", None)
    if e.sintesis_titular is not None or e.sintesis_texto is not None:
        actual = _editable(capa)
        capa["nivel"]["sintesis"] = armador.sintesis_html(
            e.sintesis_titular if e.sintesis_titular is not None else actual["sintesis_titular"],
            e.sintesis_texto if e.sintesis_texto is not None else actual["sintesis_texto"])
    if e.fortalezas is not None:
        capa["fortalezas"] = [{"titulo": plano(f.titulo), "texto": plano(f.texto)} for f in e.fortalezas]
    if e.oportunidades is not None:
        capa["oportunidades"] = [{"titulo": plano(o.titulo), "dato": plano(o.dato), "vimos": plano(o.vimos),
                                  "oportunidad": plano(o.oportunidad)} for o in e.oportunidades]
    if e.resuelve is not None:
        capa["resuelve"] = {plano(k): plano(v) for k, v in e.resuelve.items() if v}
    if e.pines is not None:
        real = capa["conversacion"]["real"]
        for m in real:
            m.pop("pin", None)
        for pin, i in e.pines.items():
            if not (isinstance(i, int) and 0 <= i < len(real)) or real[i]["tipo"] not in ("cliente", "negocio", "nota"):
                raise HTTPException(422, f"El mensaje {i} no existe o no se puede marcar")
            if "pin" in real[i]:
                raise HTTPException(422, f"El mensaje {i} ya tiene otra marca")
            real[i]["pin"] = plano(pin)
    return capa


def _validar(capa: dict):
    try:
        generador.configuracion(capa)
    except generador.ConfiguracionInvalida as exc:
        raise HTTPException(422, str(exc))


class NuevaEvaluacion(BaseModel):
    company_id: str
    numero: Optional[str] = None
    industria: Optional[str] = None
    usar_llm: bool = True


def _elegir_numero(db, company_id: str, pedido: Optional[str]) -> dict:
    from app.report_scope import select_number_analytics
    analytics_raw = db.get_analytics(company_id=company_id)
    items = analytics_raw.get("items", []) if isinstance(analytics_raw, dict) else analytics_raw
    numeros = (items[0] if items else {}).get("numbers") or []
    if pedido:
        elegido = select_number_analytics({"numbers": numeros}, pedido)
        if not elegido:
            raise HTTPException(404, "No hay conversación con ese número de esta empresa")
        return elegido
    if not numeros:
        raise HTTPException(422, "Esta empresa todavía no tiene conversación por WhatsApp para evaluar")
    return max(numeros, key=lambda n: (n.get("responses") or 0, n.get("sent") or 0))


def _veredicto(db, company_id: str, numero: str, entrada: dict) -> dict | None:
    """La clasificación Timing + IA que Análisis muestra para ese número: de ella sale el nivel.
    Una empresa con un solo número la guarda solo a nivel empresa, sin entrada por número
    (Rayogas, 2026-10-20: Análisis decía Bot y la evaluación "estimaba" el nivel); entonces vale
    la de la fila de Análisis de ese número, que es la que ve el equipo."""
    try:
        from app.classification_compare import COMPARISONS, report_verdict
        verdict = report_verdict(db, company_id, numero)
        if verdict:
            return verdict
        empresa = report_verdict(db, company_id)
        if entrada.get("category"):
            if empresa and empresa.get("category") == entrada["category"]:
                return empresa  # la misma, con su diagnóstico
            return {"category": entrada["category"], "is_ai": bool(entrada.get("is_ai"))}
        comparacion = db.db[COMPARISONS].find_one({"company_id": company_id}, {"numbers": 1}) or {}
        if empresa and not comparacion.get("numbers"):  # sin entradas por número: la de la empresa es la de su número
            return empresa
    except Exception as exc:
        log.warning("evaluación %s: sin clasificación (%s)", company_id, exc)
    return None


@router.post("/evaluaciones")
def crear_evaluacion(req: NuevaEvaluacion, x_user_token: Optional[str] = Header(None)):
    user = _usuario(x_user_token)
    db = MongoDBManager()
    company = db.get_company_full_data(req.company_id)
    if not company:
        raise HTTPException(404, "Empresa no encontrada")
    industria = req.industria or armador.industria_de(company)
    if industria not in generador.industrias():
        raise HTTPException(422, {"code": "industria", "opciones": generador.industrias(),
                                  "message": "No se detectó el giro de la empresa: elige la plantilla."})
    entrada = _elegir_numero(db, req.company_id, req.numero)
    numero = entrada["number"]
    from app.report_scope import report_thread_for_number
    thread = report_thread_for_number(db.get_conversation_thread(req.company_id), numero)
    verdict = _veredicto(db, req.company_id, numero, entrada)
    try:
        capa, info = armador.armar_cliente(company=company, thread=thread, numero=numero, verdict=verdict,
                                           industria=industria, whatsapp_name=entrada.get("whatsapp_name"),
                                           usar_llm=req.usar_llm)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    _validar(capa)
    ahora = datetime.now(timezone.utc)
    doc = {"company_id": req.company_id, "company_name": company.get("name"), "numero": numero,
           "industria": industria, "cliente": capa, "info": info, "token": secrets.token_urlsafe(18),
           "created_by": user.get("username"), "created_at": ahora, "updated_at": ahora}
    doc["_id"] = _col(db).insert_one(doc).inserted_id
    return _resumen(doc, completo=True)


@router.get("/evaluaciones")
def listar_evaluaciones(company_id: str = Query(...), x_user_token: Optional[str] = Header(None)):
    _usuario(x_user_token)
    docs = _col(MongoDBManager()).find({"company_id": company_id}, {"cliente": 0}, sort=[("created_at", -1)], limit=20)
    return {"items": [_resumen(d) for d in docs]}


def _cargar(db, evaluacion_id: str) -> dict:
    doc = _col(db).find_one({"_id": _oid(evaluacion_id)})
    if not doc:
        raise HTTPException(404, "Evaluación no encontrada")
    return doc


@router.get("/evaluaciones/{evaluacion_id}")
def ver_evaluacion(evaluacion_id: str, x_user_token: Optional[str] = Header(None)):
    _usuario(x_user_token)
    return _resumen(_cargar(MongoDBManager(), evaluacion_id), completo=True)


@router.put("/evaluaciones/{evaluacion_id}")
def editar_evaluacion(evaluacion_id: str, edicion: Edicion, x_user_token: Optional[str] = Header(None)):
    user = _usuario(x_user_token)
    db = MongoDBManager()
    doc = _cargar(db, evaluacion_id)
    capa = aplicar_edicion(doc["cliente"], edicion)
    _validar(capa)
    _col(db).update_one({"_id": doc["_id"]}, {"$set": {
        "cliente": capa, "updated_at": datetime.now(timezone.utc), "updated_by": user.get("username")}})
    doc["cliente"] = capa
    return _resumen(doc, completo=True)


@router.post("/evaluaciones/{evaluacion_id}/vista-previa", response_class=HTMLResponse)
def vista_previa(evaluacion_id: str, edicion: Edicion, x_user_token: Optional[str] = Header(None)):
    """La página con los cambios del editor SIN guardarlos (la vista previa en vivo)."""
    _usuario(x_user_token)
    doc = _cargar(MongoDBManager(), evaluacion_id)
    capa = aplicar_edicion(doc["cliente"], edicion)
    try:
        return HTMLResponse(generador.generar_evaluacion(capa), headers={"Cache-Control": "no-store"})
    except generador.ConfiguracionInvalida as exc:
        raise HTTPException(422, str(exc))


def _html(doc: dict) -> str:
    try:
        return generador.generar_evaluacion(doc["cliente"])
    except generador.ConfiguracionInvalida as exc:
        raise HTTPException(422, str(exc))


def _adjunto(doc: dict, ext: str) -> str:
    """Content-Disposition con un nombre de archivo que cualquier sistema acepta (sin acentos)."""
    nombre = unicodedata.normalize("NFKD", doc.get("company_name") or "empresa").encode("ascii", "ignore").decode()
    nombre = re.sub(r"[^A-Za-z0-9]+", "-", nombre).strip("-") or "empresa"
    return f'attachment; filename="evaluacion-whatsapp-{nombre}.{ext}"'


@router.get("/evaluaciones/{evaluacion_id}/html", response_class=HTMLResponse)
def html_evaluacion(evaluacion_id: str, descargar: bool = False, x_user_token: Optional[str] = Header(None)):
    _usuario(x_user_token)
    doc = _cargar(MongoDBManager(), evaluacion_id)
    headers = {"Cache-Control": "no-store"}
    if descargar:
        headers["Content-Disposition"] = _adjunto(doc, "html")
    return HTMLResponse(_html(doc), headers=headers)


# Cada PDF abre un Chromium (~150 MB): pocos a la vez para no ahogar al servidor.
_PDF_A_LA_VEZ = threading.BoundedSemaphore(2)


def _pdf(pagina: str) -> bytes:
    """La hoja como la imprime el navegador con el @media print de la plantilla: dos hojas carta,
    el chat de hoy y el de la experiencia con De Tu Cel. Siempre en claro y sin red: todo va
    incrustado, así que cualquier petición http(s) se corta."""
    from playwright.sync_api import sync_playwright
    pagina = re.sub(r"<html\b", '<html data-theme="light"', pagina, count=1)
    with _PDF_A_LA_VEZ, sync_playwright() as pw:
        navegador = pw.chromium.launch(headless=True)
        try:
            hoja = navegador.new_page()
            hoja.route(re.compile(r"^https?://"), lambda ruta: ruta.abort())
            hoja.set_content(pagina, wait_until="load", timeout=30_000)
            hoja.evaluate("document.fonts.ready.then(() => true)")
            return hoja.pdf(format="Letter", print_background=True, prefer_css_page_size=True)
        finally:
            navegador.close()


@router.get("/evaluaciones/{evaluacion_id}/pdf")
def pdf_evaluacion(evaluacion_id: str, x_user_token: Optional[str] = Header(None)):
    """Para mandarla como archivo (WhatsApp, correo): el PDF de lo guardado."""
    _usuario(x_user_token)
    doc = _cargar(MongoDBManager(), evaluacion_id)
    pagina = _html(doc)
    try:
        contenido = _pdf(pagina)
    except Exception as exc:
        log.warning("evaluación %s: no se pudo generar el PDF (%s)", evaluacion_id, exc)
        raise HTTPException(503, "No se pudo generar el PDF. Intenta de nuevo o descarga el HTML.")
    return Response(contenido, media_type="application/pdf",
                    headers={"Content-Disposition": _adjunto(doc, "pdf"), "Cache-Control": "no-store"})


@router.get("/evaluaciones/publica/{token}", response_class=HTMLResponse)
def html_publico(token: str):
    if len(token) < 16:
        return Response(status_code=404)
    doc = _col(MongoDBManager()).find_one({"token": token})
    if not doc:
        return Response("Evaluación no encontrada", status_code=404, media_type="text/plain; charset=utf-8")
    return HTMLResponse(_html(doc), headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow",
                                              "Referrer-Policy": "no-referrer"})
