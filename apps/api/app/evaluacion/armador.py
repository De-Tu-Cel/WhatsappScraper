"""Arma la capa "cliente" de la evaluación desde la app:

- empresa: nombre, logo (se descarga y se incrusta), teléfono y nombre de WhatsApp;
- conversación real con ese número, con días, horas y notas de espera como en Diesgas;
- nivel 1-5 desde la clasificación Timing + IA (la misma que muestra Análisis);
- síntesis, 3 cosas que ya funcionan y 3 oportunidades, con su pin en el mensaje donde se
  ven: borrador del LLM sobre la conversación numerada, con un respaldo por reglas si el
  modelo falla o contesta algo que no cuadra.

Es un BORRADOR: se guarda editable y una persona lo revisa antes de mandarlo al prospecto.
"""
import base64
import html
import io
import json
import logging
import math
import re
from datetime import datetime, timezone

from app.evaluacion import formato

log = logging.getLogger(__name__)

NIVEL_POR_CATEGORIA = {
    "sin_respuesta": 1, "automatico_sin_respuesta": 1,
    "humano": 2,
    "automatico": 3, "hibrido_automatico": 3,
    "hibrido": 4, "hibrido_bot": 4, "bot": 4, "menu": 4,
}
SINTESIS = {
    1: ("Hoy el canal no responde.", "Cada mensaje sin respuesta es un pedido que se pierde."),
    2: ("Hoy el canal depende de que alguien esté disponible.",
        "Se vuelve experiencia cuando el cliente resuelve y compra en el mismo chat, a cualquier hora."),
    3: ("Hoy el canal da servicio: saluda y canaliza.",
        "Se vuelve experiencia cuando el cliente resuelve y compra en el mismo chat, a cualquier hora."),
    4: ("Hoy el canal ya responde solo.",
        "Se vuelve experiencia cuando el cliente también hace su pedido y paga en el mismo chat."),
}
ESPERA_NOTA_S = 3600          # una espera de 1 h o más se anota en la conversación
SIN_RESPUESTA_S = 6 * 3600    # sin contestar y volvimos a escribir 6 h después: "Sin respuesta"
MAX_MENSAJES = 150
# Lo que cabe en la hoja carta de la plantilla (caracteres, el tope duro: más que esto se pide
# acortar y, si no, se recorta) y lo que se le pide al modelo (palabras: las cuenta mucho mejor).
LIMITES = {"sintesis_titular": 80, "sintesis_texto": 140, "f_titulo": 22, "f_texto": 34,
           "o_titulo": 46, "o_dato": 24, "o_vimos": 95, "o_oportunidad": 50}
# Medido 2026-10-20 con todos los textos en el tope y palabras largas: la hoja carta cabe (sin el
# aviso "[Evaluación] El contenido excede la hoja carta" de la plantilla). Si se suben, volver a medir.
PALABRAS = {"sintesis_titular": 10, "sintesis_texto": 18, "f_titulo": 3, "f_texto": 5,
            "o_titulo": 7, "o_dato": 3, "o_vimos": 14, "o_oportunidad": 7}
_TELEFONO = re.compile(r"(?<!\d)(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,3}\)?[\s.-]?)\d{3,4}[\s.-]?\d{4}(?!\d)")
_MEDIA = [("image", "📷 Imagen"), ("audio", "🎤 Audio"), ("video", "🎥 Video"), ("sticker", "Sticker"),
          ("application", "📎 Documento")]


def _fecha(valor) -> datetime | None:
    if isinstance(valor, datetime):
        return valor
    if isinstance(valor, str) and valor:
        try:
            return datetime.fromisoformat(valor.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def _texto_mensaje(m: dict) -> str:
    cuerpo = m.get("body") or m.get("message_body") or m.get("message_text") or ""
    if cuerpo.strip():
        return cuerpo
    tipo = (m.get("media_content_type") or "").lower()
    return next((etq for clave, etq in _MEDIA if clave in tipo), "Mensaje sin texto") if (tipo or m.get("media_url")) else ""


# ── conversación real ──────────────────────────────────────────────────────────
def construir_conversacion(thread: list, pais: str = "52") -> tuple[list, list, dict]:
    """(mensajes para la plantilla, renglones numerados para el LLM, métricas).
    `pais`: lada del número evaluado, para leer los teléfonos que da el negocio (Rayogas: 57)."""
    items, renglones = [], []
    metricas = {"primera_respuesta_s": None, "esperas": [], "sin_respuesta": [], "telefonos": [],
                "inicio": None, "fin": None, "mensajes": 0, "detalle": []}
    ultimo_cliente = None
    msgs = [(m, _fecha(m.get("created_at"))) for m in thread if m.get("status") != "failed"]
    msgs = [(m, _utc(dt)) for m, dt in msgs if dt and _texto_mensaje(m)]
    if len(msgs) > MAX_MENSAJES:  # pláticas largas: el principio y el final
        mitad = MAX_MENSAJES // 2
        msgs = msgs[:mitad] + [(None, None)] + msgs[-mitad:]
    dia = None
    pendiente = None   # (fecha, índice) del primer mensaje nuestro que sigue sin respuesta
    for m, dt in msgs:
        if m is None:
            items.append({"tipo": "nota", "texto": "…"})
            pendiente = None
            continue
        sale = m.get("direction") == "outbound"
        if sale and pendiente and (dt - pendiente[0]).total_seconds() >= SIN_RESPUESTA_S:
            items.append({"tipo": "nota", "texto": "Sin respuesta en el chat"})
            metricas["sin_respuesta"].append(pendiente[1])
            pendiente = None
        if not sale and pendiente:
            espera = (dt - pendiente[0]).total_seconds()
            if espera >= ESPERA_NOTA_S:
                items.append({"tipo": "nota", "texto": f"{formato.duracion(espera)} después"})
                metricas["esperas"].append({"segundos": espera, "desde": pendiente[0], "hasta": dt,
                                            "indice": len(items) + (1 if formato.a_mx(dt).date() != dia else 0)})
        local = formato.a_mx(dt).date()
        if local != dia:
            items.append({"tipo": "dia", "texto": formato.fecha_dia(dt)})
            dia = local
        texto = _texto_mensaje(m)
        indice = len(items)
        items.append({"tipo": "cliente" if sale else "negocio", "texto": formato.whatsapp_a_html(texto),
                      "hora": formato.hora(dt)})
        renglones.append(f"[{indice}] {'Cliente (nosotros)' if sale else 'Negocio'} · {formato.fecha_dia(dt)} "
                         f"{formato.hora(dt)}: {formato.texto_plano(texto, 400)}")
        metricas["inicio"] = metricas["inicio"] or dt
        metricas["fin"] = dt
        metricas["mensajes"] += 1
        metricas["detalle"].append({"i": indice, "sale": sale, "dt": dt, "texto": texto,
                                    "tras_cliente_s": None if sale or not ultimo_cliente else (dt - ultimo_cliente).total_seconds()})
        if sale:
            ultimo_cliente = dt
            pendiente = pendiente or (dt, indice)
        else:
            # Desde el mensaje al que contesta, no desde el primero que mandamos: Gas de Tlalnepantla
            # (2026-10-20) no contestó un "Hola" de agosto y en octubre su aviso llegó al instante;
            # medido desde agosto salían "1492 h" de primera respuesta.
            if metricas["primera_respuesta_s"] is None and pendiente:
                metricas["primera_respuesta_s"] = max(0.0, (dt - pendiente[0]).total_seconds())
            pendiente = None
            for tel in _TELEFONO.findall(texto):
                digitos = re.sub(r"\D", "", tel)
                if len(digitos) >= 10:
                    numero = digitos if len(digitos) > 10 else pais + digitos
                    metricas["telefonos"].append({"telefono": formato.telefono(numero), "indice": indice})
    if pendiente:
        items.append({"tipo": "nota", "texto": "Sin respuesta en el chat"})
        metricas["sin_respuesta"].append(pendiente[1])
    return items, renglones, metricas


# ── hechos comprobables ────────────────────────────────────────────────────────
# Lo que se puede comprobar en la conversación, con su mensaje y su hora. Con ellos se arma el
# borrador por reglas; el modelo solo los REDACTA (la etiqueta y la marca salen del hecho, no del
# modelo), y el editor los ofrece como textos listos para elegir.
_AUTOMATICO = re.compile(r"bienvenid|gracias por (?:comunicarte|escribir|contactar|tu mensaje)|en un momento|"
                         r"fuera de(?:l)? (?:nuestro )?horario|horario de atenci[oó]n|pronto (?:te|estaremos)|"
                         r"no podemos responder|aviso de privacidad|datos personales|autoriza", re.I)
_FUERA_HORARIO = re.compile(r"fuera de(?:l)? (?:nuestro )?horario|horario de atenci[oó]n|no podemos responder|"
                            r"pronto estaremos|te responderemos", re.I)
_BIENVENIDA = re.compile(r"bienvenid|gracias por (?:comunicarte|escribir|contactar)|te atiende", re.I)
_PRIVACIDAD = re.compile(r"privacidad|datos personales|tratamiento de (?:tus |sus )?datos|autoriza", re.I)
_PIDE_DATOS = re.compile(r"\b(?:nombre|direcci[oó]n|domicilio|colonia|correo|municipio|c[oó]digo postal|ubicaci[oó]n)\b", re.I)
_ZONA = re.compile(r"\b(?:municipio|colonia|zona|cobertura)\b|d[oó]nde (?:se encuentra|est[aá])", re.I)
_PRECIO = re.compile(r"\$\s?\d|\bprecios?\b|\bcostos?\b|\bpesos\b|\bpor litro\b", re.I)
_MENU = re.compile(r"(?m)^\s*(?:\d+[.)]|[🔷🔹▪•*-]|\d️⃣)")


def _es_automatico(d: dict) -> bool:
    """Llegó al instante tras nuestro mensaje (≤10 s) o es un texto de plantilla (bienvenida, aviso…)."""
    return (d["tras_cliente_s"] is not None and d["tras_cliente_s"] <= 10) or bool(_AUTOMATICO.search(d["texto"]))


def detectar_hechos(items: list, metricas: dict) -> dict:
    """Hechos de la conversación. Oportunidades en orden de gravedad: {id, tipo, dato, mensaje,
    titulo, vimos, oportunidad, ventaja}; fortalezas: {id, tipo, mensaje, titulo, texto}."""
    por_indice = {d["i"]: d for d in metricas["detalle"]}
    negocio = [d for d in metricas["detalle"] if not d["sale"]]
    cliente = [d for d in metricas["detalle"] if d["sale"]]
    automaticos = [d for d in negocio if _es_automatico(d)]
    humanos = [d for d in negocio if not _es_automatico(d)]

    def dia(i):
        return formato.fecha_dia(por_indice[i]["dt"]).split(",")[0].lower()

    op = []

    def oportunidad(tipo, dato, mensaje, titulo, vimos, texto, ventaja):
        op.append({"tipo": tipo, "dato": dato, "mensaje": mensaje, "titulo": titulo, "vimos": vimos,
                   "oportunidad": texto, "ventaja": ventaja})

    for i in metricas["sin_respuesta"][:2]:
        oportunidad("sin_respuesta", "Sin respuesta", i, "Un mensaje quedó sin respuesta",
                    f"Nuestro mensaje del {dia(i)} a las {items[i]['hora']} no tuvo respuesta.",
                    "Resolver al momento las dudas frecuentes.", "b2")
    if automaticos and not humanos:
        a = automaticos[0]
        oportunidad("solo_automatico", "Solo automático", a["i"], "Solo respondió el mensaje automático",
                    f"A las {items[a['i']]['hora']} llegó el mensaje automático; nadie más respondió.",
                    "Atender y tomar pedidos a cualquier hora.", "b1")
    if metricas["esperas"]:
        e = max(metricas["esperas"], key=lambda x: x["segundos"])
        horas = f"{int(e['segundos'] // 3600)} h" if e["segundos"] >= 3600 else formato.duracion(e["segundos"])
        otro_dia = formato.a_mx(e["hasta"]).date() != formato.a_mx(e["desde"]).date()
        oportunidad("espera", f"{horas} de espera", e["indice"], "El cliente espera la respuesta",
                    f"Escribimos a las {formato.hora(e['desde'])} y respondieron a las {formato.hora(e['hasta'])}"
                    f"{' del día siguiente' if otro_dia else ''}.", "Atender y tomar pedidos las 24 horas.", "b1")
    fuera = next((d for d in negocio if _FUERA_HORARIO.search(d["texto"])), None)
    if fuera:
        oportunidad("fuera_horario", "Aviso fuera de horario", fuera["i"], "Fuera de horario, el cliente espera",
                    f"A las {items[fuera['i']]['hora']} solo llegó un aviso de fuera de horario.",
                    "Atender y tomar pedidos las 24 horas.", "b1")
    if metricas["telefonos"]:
        t = metricas["telefonos"][0]
        oportunidad("telefono", "Pedido por llamada", t["indice"], "El pedido sale de WhatsApp",
                    f"Para pedir, nos dieron el teléfono {t['telefono']}.", "Que pida y pague en la misma conversación.", "b3")
    priv = next((d for d in negocio if _PRIVACIDAD.search(d["texto"])), None)
    if priv:
        oportunidad("privacidad", "Trámite al inicio", priv["i"], "Un trámite antes de atender",
                    f"A las {items[priv['i']]['hora']}, antes de atender, pidieron autorizar el uso de datos.",
                    "Atender primero; pedir datos solo al pedir.", "b2")
    pide = next((d for d in humanos if "?" in d["texto"] and _PIDE_DATOS.search(d["texto"])), None)
    if pide:
        oportunidad("pide_datos", "Pide datos primero", pide["i"], "Datos antes de resolver",
                    f"A las {items[pide['i']]['hora']} pidieron datos antes de resolver la duda.",
                    "Reconocer el número y recordar su dirección.", "b4")
    if any(_PRECIO.search(d["texto"]) for d in cliente) and not any(_PRECIO.search(d["texto"]) for d in negocio):
        pregunta = next(d for d in cliente if _PRECIO.search(d["texto"]))
        oportunidad("sin_precio", "Sin precio", pregunta["i"], "El precio no se compartió",
                    f"Preguntamos el precio a las {items[pregunta['i']]['hora']} y no lo dieron en el chat.",
                    "Dar precio y tomar el pedido al momento.", "b3")
    oportunidad("sin_cierre", "Sin pedido en chat", negocio[-1]["i"] if negocio else None,
                "El pedido no se cierra en el chat", "La plática no llegó a tomar el pedido.",
                "Que pida y pague en la misma conversación.", "b3")
    oportunidad("sin_seguimiento", "Sin seguimiento", None, "No hay seguimiento al cliente",
                "Después de la plática nadie dio seguimiento.", "Dar seguimiento y medir la satisfacción.", "b7")
    oportunidad("sin_historial", "Sin historial", None, "El cliente no queda reconocido",
                "Cada vez hay que repetir los datos.", "Reconocer el número y recordar su dirección.", "b4")

    fo = []

    def fortaleza(tipo, mensaje, titulo, texto):
        fo.append({"tipo": tipo, "mensaje": mensaje, "titulo": titulo, "texto": texto})

    rapida = metricas.get("primera_respuesta_s")
    if rapida is not None and rapida <= 60 and negocio:
        auto = _es_automatico(negocio[0])
        fortaleza("respuesta_rapida", negocio[0]["i"], f"Respuesta en {formato.duracion(rapida)}",
                  "Mensaje automático al instante." if auto else "Contestan casi al instante.")
    bienvenida = next((d for d in negocio if _BIENVENIDA.search(d["texto"])), None)
    if bienvenida:
        fortaleza("bienvenida", bienvenida["i"], "Bienvenida clara", "Saluda con su marca.")
    menu = next((d for d in negocio if len(_MENU.findall(d["texto"])) >= 2), None)
    if menu:
        fortaleza("menu", menu["i"], "Menú que orienta", "Guía al cliente a su opción.")
    zona = next((d for d in humanos if _ZONA.search(d["texto"])), None)
    if zona:
        fortaleza("cobertura", zona["i"], "Verifica cobertura", "Pregunta la zona de entrega.")
    precio = next((d for d in negocio if _PRECIO.search(d["texto"])), None)
    if precio:
        fortaleza("precio", precio["i"], "Comparte precios", "Da costos en el chat.")
    if humanos:
        fortaleza("trato_personal", humanos[-1]["i"], "Trato personal", "Una persona atiende el chat.")
    if negocio:
        fortaleza("canal_activo", negocio[0]["i"], "Canal activo", "El WhatsApp sí recibe mensajes.")
    else:
        fortaleza("numero_activo", None, "Número en WhatsApp", "El número sí existe en WhatsApp.")
    for k, h in enumerate(op, 1):
        h["id"] = f"H{k}"
    for k, h in enumerate(fo, 1):
        h["id"] = f"F{k}"
    return {"oportunidades": op, "fortalezas": fo, "humanos": len(humanos), "automaticos": len(automaticos)}


def elegir_hechos(hechos: dict) -> tuple[list, list]:
    """Las 3 oportunidades más graves con ventajas distintas y 3 fortalezas en mensajes distintos."""
    oportunidades, ventajas = [], set()
    for h in hechos["oportunidades"]:
        if h["ventaja"] not in ventajas:
            oportunidades.append(h)
            ventajas.add(h["ventaja"])
        if len(oportunidades) == 3:
            break
    fortalezas, mensajes = [], set()
    for h in hechos["fortalezas"]:
        if h["mensaje"] is None or h["mensaje"] not in mensajes:
            fortalezas.append(h)
            mensajes.add(h["mensaje"])
        if len(fortalezas) == 3:
            break
    for h in hechos["fortalezas"]:  # conversación corta: se completa aunque repita mensaje
        if len(fortalezas) < 3 and h not in fortalezas:
            fortalezas.append(h)
    return oportunidades, fortalezas


# ── nivel ──────────────────────────────────────────────────────────────────────
def nivel_desde(verdict: dict | None, metricas: dict, hechos: dict | None = None) -> tuple[int, str]:
    if verdict and verdict.get("category") in NIVEL_POR_CATEGORIA:
        return NIVEL_POR_CATEGORIA[verdict["category"]], "clasificacion"
    if hechos is None:
        if metricas.get("primera_respuesta_s") is None:
            return 1, "reglas"
        return (3 if metricas["primera_respuesta_s"] <= 10 else 2), "reglas"
    if not hechos["humanos"]:
        return 1, "reglas"  # nadie contestó, o solo el mensaje automático (como "Automático + sin respuesta")
    return (3 if hechos["automaticos"] else 2), "reglas"


def sintesis_html(titular: str, texto: str) -> str:
    """La plantilla pinta la síntesis con innerHTML: solo nuestras <b>, el resto escapado."""
    return f"<b>{html.escape(formato.texto_plano(titular, LIMITES['sintesis_titular']))}</b> " \
           f"{html.escape(formato.texto_plano(texto, LIMITES['sintesis_texto']))}"


# ── hallazgos por reglas (respaldo) ────────────────────────────────────────────
def hallazgos_por_reglas(items: list, metricas: dict, nivel: int, hechos: dict | None = None) -> dict:
    hechos = hechos or detectar_hechos(items, metricas)
    oportunidades, fortalezas = elegir_hechos(hechos)
    titular, texto = SINTESIS[nivel]
    campos_o = ("titulo", "dato", "vimos", "oportunidad", "mensaje", "ventaja")
    return {"sintesis_titular": titular, "sintesis_texto": texto,
            "fortalezas": [{k: f[k] for k in ("titulo", "texto", "mensaje")} for f in fortalezas],
            "oportunidades": [{k: o[k] for k in campos_o} for o in oportunidades]}


# ── hallazgos con el LLM ───────────────────────────────────────────────────────
_PROMPT = """Eres analista de De Tu Cel. Escribimos al WhatsApp de "{empresa}" ({giro}) como si fuéramos un cliente nuevo.
Conversación real, numerada:

{conversacion}

HECHOS COMPROBADOS en esa conversación (no hay otros; no inventes):
Oportunidades:
{hechos_op}
Lo que hace bien:
{hechos_fo}
Clasificación del canal: {clasificacion}. Nivel {nivel} de 5 ({nombre_nivel}).

Tu trabajo es REDACTAR, en español de México, tono profesional y cálido. REGLAS:
- Cada oportunidad se basa en UN hecho H distinto y cada fortaleza en un hecho F: pon su id en "hecho".
- Con tus palabras, pero sin cambiar los datos del hecho: horas, fechas y cifras tal cual.
- Un mensaje que llega en 10 s o menos es automático, no una persona.
- Respeta el máximo de PALABRAS de cada campo: es una hoja impresa y no cabe más. Sin puntos suspensivos.
- Frases completas: nunca termines en "y", "con", "de" ni a medias. Si no cabe, di menos.
- Habla del negocio en tercera persona ("su marca", "su chat"); nunca "tú" ni "tu".
Campos:
- "sintesis_titular": diagnóstico del canal en una frase (máx. {sintesis_titular} palabras).
- "sintesis_texto": qué le falta para ser una experiencia de compra (máx. {sintesis_texto} palabras).
- "fortalezas": exactamente 3 (si hay menos hechos F, repite uno con otro enfoque): "hecho", "titulo" tipo
  etiqueta (máx. {f_titulo} palabras), "texto" (máx. {f_texto} palabras).
- "oportunidades": exactamente 3, las que más pesan para el negocio, con hechos H distintos: "hecho",
  "titulo" (máx. {o_titulo} palabras), "vimos": lo que pasó (máx. {o_vimos} palabras),
  "oportunidad": cómo se resuelve (máx. {o_oportunidad} palabras).
Responde SOLO JSON: {{"sintesis_titular": "", "sintesis_texto": "", "fortalezas": [{{"hecho": "F1", "titulo": "", "texto": ""}}], "oportunidades": [{{"hecho": "H1", "titulo": "", "vimos": "", "oportunidad": ""}}]}}"""


def hallazgos_con_llm(empresa, giro, renglones, metricas, verdict, nivel, escala, ventajas, hechos=None) -> dict:
    from app.config import CLASSIFIER_MODEL
    from app.llm import PRIORITY_BATCH, call_llm
    hechos = hechos or {"oportunidades": [], "fortalezas": []}

    def linea_op(h):
        donde = f" · mensaje [{h['mensaje']}]" if h["mensaje"] is not None else ""
        return f"{h['id']} · {h['dato']}{donde}: {h['vimos']}"

    def linea_fo(h):
        donde = f" · mensaje [{h['mensaje']}]" if h["mensaje"] is not None else ""
        return f"{h['id']}{donde}: {h['titulo']}. {h['texto']}"
    clasificacion = (verdict or {}).get("notes") or (verdict or {}).get("category") or "sin clasificación"
    prompt = _PROMPT.format(
        empresa=empresa, giro=giro, conversacion="\n".join(renglones).replace("{", "(").replace("}", ")"),
        hechos_op="\n".join(linea_op(h) for h in hechos["oportunidades"]) or "(ninguno)",
        hechos_fo="\n".join(linea_fo(h) for h in hechos["fortalezas"]) or "(ninguno)",
        clasificacion=clasificacion, nivel=nivel, nombre_nivel=escala[nivel - 1]["nombre"], **PALABRAS)
    raw = call_llm([{"role": "user", "content": prompt}], max_tokens=1200, temperature=0.2,
                   priority=PRIORITY_BATCH, model=CLASSIFIER_MODEL, json_output=True)
    return json.loads(re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip())


_VENTAJA_POR_TEXTO = [
    (re.compile(r"espera|horario|noche|24|tard[oó]|demora", re.I), "b1"),
    (re.compile(r"sin respuesta|duda|pregunta|informaci[oó]n|abiert", re.I), "b2"),
    (re.compile(r"pedido|llamad|tel[eé]fono|compra|pag", re.I), "b3"),
    (re.compile(r"reconoc|direcci[oó]n|historial|repet", re.I), "b4"),
    (re.compile(r"seguimiento|satisfacci|encuesta|calific", re.I), "b7"),
]


def _ventaja_por_texto(o: dict) -> str | None:
    texto = " ".join(str(o.get(k) or "") for k in ("dato", "titulo", "oportunidad"))
    return next((v for patron, v in _VENTAJA_POR_TEXTO if patron.search(texto)), None)


_CAMPOS = [("sintesis_titular", "sintesis_titular"), ("sintesis_texto", "sintesis_texto")]
_CAMPOS_F = [("titulo", "f_titulo"), ("texto", "f_texto")]
_CAMPOS_O = [("titulo", "o_titulo"), ("dato", "o_dato"), ("vimos", "o_vimos"), ("oportunidad", "o_oportunidad")]


def _excedidos(datos: dict) -> dict:
    """{ruta: (texto, clave de límite)} de lo que el modelo escribió más largo de lo que cabe."""
    out = {}
    for campo, clave in _CAMPOS:
        texto = formato.texto_plano(datos.get(campo))
        if len(texto) > LIMITES[clave]:
            out[campo] = (texto, clave)
    for lista, campos, pref in (("fortalezas", _CAMPOS_F, "f"), ("oportunidades", _CAMPOS_O, "o")):
        for k, item in enumerate((datos.get(lista) or [])[:3]):
            if not isinstance(item, dict):
                continue
            for campo, clave in campos:
                texto = formato.texto_plano(item.get(campo))
                if len(texto) > LIMITES[clave]:
                    out[f"{pref}{k}.{campo}"] = (texto, clave)
    return out


def acortar_con_llm(excedidos: dict) -> dict:
    """Segunda pasada corta: reescribe SOLO lo que no cabe, sin perder el dato (horas, cifras).
    Se pide en palabras (una menos que el tope): el modelo cuenta mal los caracteres."""
    from app.config import CLASSIFIER_MODEL
    from app.llm import PRIORITY_BATCH, call_llm
    renglones = "\n".join(f'"{ruta}" (máx. {max(2, PALABRAS[clave] - 1)} palabras): {texto}'
                          for ruta, (texto, clave) in excedidos.items())
    prompt = ("Reescribe cada texto para que quepa en su máximo de caracteres. Conserva el dato clave (horas, fechas, "
              "cifras) y el sentido; usa menos palabras, sin puntos suspensivos. Español de México.\n\n" + renglones.replace("{", "(").replace("}", ")") +
              '\n\nResponde SOLO JSON con las mismas llaves: {"ruta": "texto corto"}')
    raw = call_llm([{"role": "user", "content": prompt}], max_tokens=700, temperature=0,
                   priority=PRIORITY_BATCH, model=CLASSIFIER_MODEL, json_output=True)
    return json.loads(re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip())


def aplicar_acortados(datos: dict, excedidos: dict, cortos: dict) -> int:
    """Pone las versiones cortas que sí caben. Devuelve cuántas se usaron."""
    usados = 0
    for ruta, (_texto, clave) in excedidos.items():
        nuevo = formato.texto_plano(cortos.get(ruta))
        if not nuevo or len(nuevo) > LIMITES[clave]:
            continue
        if "." in ruta:
            pref, campo = ruta.split(".")
            lista = "fortalezas" if pref[0] == "f" else "oportunidades"
            datos[lista][int(pref[1:])][campo] = nuevo
        else:
            datos[ruta] = nuevo
        usados += 1
    return usados


# La hoja habla del negocio en tercera persona ("su marca"). El modelo a veces le habla de tú
# ("Saluda con tu marca", Rayogas 2026-10-20) aunque el prompt lo pide: ese texto no se usa.
_SEGUNDA_PERSONA = re.compile(r"\b(?:tú|tu|tus|te|ti|contigo)\b", re.I)


def depurar_hallazgos(datos: dict, items: list, ventajas_ids: set, respaldo: dict,
                      hechos: dict | None = None) -> tuple[dict, dict]:
    """Recorta a los límites y valida. Si el modelo citó un hecho ("hecho": "H2"), la etiqueta, la
    marca y la ventaja salen del hecho, no del modelo. Lo que falta se completa con el respaldo.
    Devuelve (hallazgos, notas) con lo que hubo que corregir, para avisarle al revisor."""
    notas = {"marcas_invalidas": 0, "completadas": 0, "recortados": 0}
    tipos = {i: m["tipo"] for i, m in enumerate(items)}
    hechos = hechos or {"oportunidades": [], "fortalezas": []}
    por_id = {h["id"]: h for h in hechos["oportunidades"] + hechos["fortalezas"]}

    def marca(n, permitidos):
        if isinstance(n, int) and tipos.get(n) in permitidos:
            return n
        if n is not None:
            notas["marcas_invalidas"] += 1
        return None

    def cabe(texto, clave, del_hecho=None):
        """El texto del modelo si cabe y habla del negocio en tercera persona; si no, el del hecho
        (ya medido para la hoja) antes que cortarlo con "…". Solo lo propio se recorta."""
        t = formato.texto_plano(texto)
        if t and len(t) <= LIMITES[clave] and not (del_hecho and _SEGUNDA_PERSONA.search(t)):
            return t
        if del_hecho:
            return formato.texto_plano(del_hecho, LIMITES[clave])
        if len(t) > LIMITES[clave]:
            notas["recortados"] += 1
        return formato.texto_plano(t, LIMITES[clave])

    fort = []
    for f in (datos.get("fortalezas") or [])[:3]:
        if not isinstance(f, dict) or not f.get("titulo"):
            continue
        h = por_id.get(str(f.get("hecho") or ""))
        h = h if h and h["id"].startswith("F") else None
        fort.append({"titulo": cabe(f["titulo"], "f_titulo", h and h["titulo"]),
                     "texto": cabe(f.get("texto"), "f_texto", h and h["texto"]),
                     "mensaje": h["mensaje"] if h else marca(f.get("mensaje"), {"negocio"})})
    oport, usadas, citados, remedios = [], set(), set(), set()
    for o in (datos.get("oportunidades") or [])[:3]:
        if not isinstance(o, dict) or not o.get("titulo"):
            continue
        h = por_id.get(str(o.get("hecho") or ""))
        h = h if h and h["id"].startswith("H") and h["id"] not in citados else None
        if h:
            citados.add(h["id"])
            dato, mensaje, propuesta = h["dato"], h["mensaje"], h["ventaja"]
            # "La oportunidad" es el remedio de De Tu Cel para ese hecho: va el texto curado (el del
            # modelo salía forzado al comprimirlo: "Respuesta automática con horario y pronta…"),
            # salvo que otra oportunidad ya lo use.
            if h["oportunidad"] not in remedios:
                o = {**o, "oportunidad": h["oportunidad"]}
        else:  # sin hecho: lo que diga el modelo, verificado después (verificar_datos)
            dato, mensaje, propuesta = o.get("dato"), marca(o.get("mensaje"), {"negocio", "cliente"}), o.get("ventaja")
        ventaja = propuesta if propuesta in ventajas_ids and propuesta not in usadas else None
        if not ventaja:  # inválida o repetida: se deduce del texto (sin repetir)
            deducida = _ventaja_por_texto({**o, "dato": dato})
            ventaja = deducida if deducida in ventajas_ids and deducida not in usadas else None
        if ventaja:
            usadas.add(ventaja)
        oport.append({"titulo": cabe(o["titulo"], "o_titulo", h and h["titulo"]),
                      "dato": formato.texto_plano(dato, LIMITES["o_dato"]),
                      "vimos": cabe(o.get("vimos"), "o_vimos", h and h["vimos"]),
                      "oportunidad": cabe(o.get("oportunidad"), "o_oportunidad", h and h["oportunidad"]),
                      "mensaje": mensaje, "ventaja": ventaja})
        remedios.add(oport[-1]["oportunidad"])
    if len(fort) < 3:
        faltan = [f for f in respaldo["fortalezas"] if f["titulo"] not in {x["titulo"] for x in fort}][:3 - len(fort)]
        notas["completadas"] += len(faltan)
        fort += faltan
    if len(oport) < 3:
        # Sin repetir el tema de una que ya está (misma ventaja o mismo dato).
        datos_usados = {o["dato"].lower() for o in oport}
        faltan = [o for o in respaldo["oportunidades"]
                  if o.get("ventaja") not in usadas and o["dato"].lower() not in datos_usados][:3 - len(oport)]
        notas["completadas"] += len(faltan)
        oport += faltan
    titular, texto = datos.get("sintesis_titular"), datos.get("sintesis_texto")
    if not titular or _SEGUNDA_PERSONA.search(titular):
        titular = respaldo["sintesis_titular"]
    if not texto or _SEGUNDA_PERSONA.search(texto):
        texto = respaldo["sintesis_texto"]
    return {"sintesis_titular": titular, "sintesis_texto": texto, "fortalezas": fort, "oportunidades": oport}, notas


def _segundos_de(dato: str) -> float | None:
    m = re.search(r"(\d+)\s*h(?:\s*(\d+)\s*min)?|(\d+)\s*min", dato)
    if not m:
        return None
    if m.group(3):
        return int(m.group(3)) * 60
    return int(m.group(1)) * 3600 + int(m.group(2) or 0) * 60


def verificar_datos(oportunidades: list, metricas: dict) -> list:
    """Las etiquetas que afirman un hecho medible solo se quedan si lo medido lo respalda (el
    modelo marcaba "Sin respuesta" a una pregunta que sí contestaron y "Pedido por llamada" sin
    que dieran teléfono). Si no cuadra, se quita la etiqueta. Devuelve las etiquetas quitadas."""
    quitadas = []
    for o in oportunidades:
        dato = (o.get("dato") or "").lower()
        falso = False
        if "sin respuesta" in dato:
            falso = o.get("mensaje") not in metricas["sin_respuesta"]
        elif "llamada" in dato or "teléfono" in dato or "telefono" in dato:
            falso = not metricas["telefonos"]
        elif "espera" in dato:
            s = _segundos_de(dato)
            falso = s is None or not any(abs(e["segundos"] - s) <= max(3600, e["segundos"] * 0.1) for e in metricas["esperas"])
        if falso:
            quitadas.append(o["dato"])
            o["dato"] = ""
    return quitadas


def poner_pines(items: list, hallazgos: dict) -> list:
    """Un pin por mensaje: v1..v3 para lo que funciona, 1..3 para oportunidades. Devuelve los
    hallazgos que tenían mensaje pero no encontraron uno libre (conversaciones muy cortas)."""
    sin_lugar = []
    for m in items:
        m.pop("pin", None)

    def libre(n, tipos):
        """El mensaje pedido o, si ya tiene marca, el más cercano libre del mismo tipo."""
        if not (isinstance(n, int) and 0 <= n < len(items)):
            return None
        for d in range(len(items)):
            for j in (n + d, n - d):
                if 0 <= j < len(items) and items[j]["tipo"] in tipos and "pin" not in items[j]:
                    return j
        return None

    for prefijo, lista, tipos in (("", hallazgos["oportunidades"], ("negocio", "cliente", "nota")),
                                  ("v", hallazgos["fortalezas"], ("negocio",))):
        for k, h in enumerate(lista, 1):
            if h.get("mensaje") is None:
                continue
            j = libre(h["mensaje"], tipos)
            if j is None:
                sin_lugar.append(f"{prefijo}{k}")
            else:
                items[j]["pin"] = f"{prefijo}{k}"
    return sin_lugar


# ── empresa ────────────────────────────────────────────────────────────────────
def url_publica(url: str) -> bool:
    """Solo http(s) a puertos 80/443 de IPs públicas. El logo_url sale de páginas de terceros:
    una página maliciosa podría apuntarlo a la red interna del servidor (SSRF)."""
    import ipaddress
    import socket
    from urllib.parse import urlsplit
    try:
        partes = urlsplit(url)
        if partes.scheme not in ("http", "https") or not partes.hostname:
            return False
        if partes.port not in (None, 80, 443):
            return False
        ips = {info[4][0] for info in socket.getaddrinfo(partes.hostname, partes.port or 443, proto=socket.IPPROTO_TCP)}
        return bool(ips) and all(ipaddress.ip_address(ip.split("%")[0]).is_global for ip in ips)
    except (OSError, ValueError):
        return False


_IMAGENES = {"image/png", "image/jpeg", "image/webp", "image/gif", "image/x-icon", "image/vnd.microsoft.icon"}


def logo_incrustado(url: str | None, max_bytes: int = 1_500_000) -> str | None:
    if not url or not url_publica(str(url)):
        return None
    try:
        import requests
        # Sin redirecciones: una redirección podría llevar a una IP interna después de la revisión.
        with requests.get(url, timeout=6, stream=True, allow_redirects=False,
                          headers={"User-Agent": "Mozilla/5.0 (DeTuCel evaluacion)"}) as r:
            tipo = (r.headers.get("content-type") or "").split(";")[0].strip().lower()
            if r.status_code != 200 or tipo not in _IMAGENES:  # sin SVG: puede traer scripts
                return None
            datos = r.raw.read(max_bytes + 1, decode_content=True)
        if len(datos) > max_bytes or len(datos) < 100:
            return None
        return f"data:{tipo};base64,{base64.b64encode(datos).decode('ascii')}"
    except Exception as exc:
        log.info("Evaluación: no se pudo bajar el logo %s (%s)", url, exc)
        return None


_FIRMAS = {"image/png": (b"\x89PNG\r\n\x1a\n",), "image/jpeg": (b"\xff\xd8\xff",), "image/webp": (b"RIFF",)}


def logo_subido(data_url: str, max_bytes: int = 1_000_000) -> str:
    """Logo subido por la persona (data URL). Se valida el contenido, no solo el tipo declarado."""
    m = re.fullmatch(r"data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)", data_url or "")
    if not m:
        raise ValueError("El logo debe ser una imagen PNG, JPG o WEBP.")
    try:
        datos = base64.b64decode(m.group(2), validate=False)
    except Exception:
        raise ValueError("La imagen del logo no se pudo leer.")
    if len(datos) > max_bytes:
        raise ValueError("El logo pesa más de 1 MB.")
    tipo = m.group(1)
    if not datos.startswith(_FIRMAS[tipo]) or (tipo == "image/webp" and datos[8:12] != b"WEBP"):
        raise ValueError("El archivo no es la imagen que dice ser.")
    return f"data:{tipo};base64,{base64.b64encode(datos).decode('ascii')}"


def avatar_de_logo(logo: str | None, lado: int = 192) -> str | None:
    """Foto de perfil del chat de la hoja: el logo completo, centrado sobre blanco. La plantilla
    recorta el avatar en círculo (object-fit: cover) y un logo ancho quedaba cortado a la mitad."""
    m = re.fullmatch(r"data:image/[\w.+-]+;base64,([A-Za-z0-9+/=\s]+)", logo or "")
    if not m:
        return None
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(base64.b64decode(m.group(1))))
        if img.width * img.height > 25_000_000:  # antes de decodificar: nada de bombas de pixeles
            return None
        img = img.convert("RGBA")
        escala = 0.9 * lado / math.hypot(img.width, img.height)  # que quepa entero en el círculo
        img = img.resize((max(1, round(img.width * escala)), max(1, round(img.height * escala))), Image.LANCZOS)
        fondo = Image.new("RGBA", (lado, lado), (255, 255, 255, 255))
        fondo.alpha_composite(img, ((lado - img.width) // 2, (lado - img.height) // 2))
        buf = io.BytesIO()
        fondo.convert("RGB").save(buf, "PNG", optimize=True)
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception as exc:
        log.info("Evaluación: no se pudo armar el avatar desde el logo (%s)", exc)
        return None


def poner_logo(cliente: dict, logo: str | None) -> None:
    """Logo del encabezado y, con él, la foto de perfil del chat. Sin logo: nombre e iniciales."""
    cliente.pop("logo", None)
    cliente.pop("avatar", None)
    if logo:
        cliente["logo"] = logo
        avatar = avatar_de_logo(logo)
        if avatar:
            cliente["avatar"] = avatar


def industria_de(company: dict) -> str | None:
    from app.classifier import industry_profile
    texto = " ".join(str(company.get(k) or "") for k in ("industry", "name", "main_activity"))
    texto += " " + str((company.get("metadata") or {}).get("maps_category") or "")
    return "gaseras" if industry_profile(texto) == "gas" else None


def armar_cliente(*, company: dict, thread: list, numero: str, verdict: dict | None, industria: str,
                  whatsapp_name: str | None = None, usar_llm: bool = True, ahora: datetime | None = None,
                  bajar_logo=logo_incrustado) -> tuple[dict, dict]:
    """(capa cliente para generador.generar_evaluacion, info del borrador)."""
    from app.evaluacion.generador import RAIZ, leer_json
    giro = leer_json(RAIZ / "config" / "industrias" / f"{industria}.json")
    escala = leer_json(RAIZ / "config" / "base.json")["nivel"]["escala"]
    pais = re.sub(r"\D", "", numero or "")[:-10] or "52"
    items, renglones, metricas = construir_conversacion(thread, pais=pais[:3])
    if not metricas["mensajes"]:
        raise ValueError("No hay conversación con ese número para evaluar.")
    hechos = detectar_hechos(items, metricas)
    nivel, fuente_nivel = nivel_desde(verdict, metricas, hechos)
    respaldo = hallazgos_por_reglas(items, metricas, nivel, hechos)
    ventajas_ids = {v["id"] for v in giro.get("ventajas", [])}
    origen, notas, quitadas, recortados, sin_ia = "reglas", {"marcas_invalidas": 0, "completadas": 0}, [], 0, False
    hallazgos = respaldo
    if usar_llm:
        try:
            crudo = hallazgos_con_llm(company.get("name") or "la empresa", giro["industria"]["plural"], renglones,
                                      metricas, verdict, nivel, escala, giro.get("ventajas", []), hechos)
            for _intento in range(2):  # mejor una frase completa más corta que una cortada con "…"
                largos = _excedidos(crudo)
                if not largos:
                    break
                try:
                    aplicar_acortados(crudo, largos, acortar_con_llm(largos))
                except Exception as exc:
                    log.info("Evaluación: no se pudieron acortar textos (%s)", exc)
                    break
            hallazgos, notas = depurar_hallazgos(crudo, items, ventajas_ids, respaldo, hechos)
            quitadas = verificar_datos(hallazgos["oportunidades"], metricas)
            recortados = notas["recortados"]
            origen = "llm"
        except Exception as exc:
            log.warning("Evaluación %s: el modelo no generó hallazgos (%s); se usan reglas", company.get("name"), exc)
            sin_ia = True
    sin_lugar = poner_pines(items, hallazgos)
    nombre = company.get("name") or company.get("domain") or "La empresa"
    cliente = {"nombre": nombre, "logoAlt": nombre, "telefono": formato.telefono(numero),
               "nombreBot": formato.texto_plano(whatsapp_name, 40) or nombre}
    logo = bajar_logo(company.get("logo_url"))
    poner_logo(cliente, logo)

    # Avisos para el revisor: pocos, claros y accionables (Rayogas, 2026-10-20: salían 11).
    avisos = []
    if metricas["mensajes"] < 5:
        avisos.append(f"Conversación corta ({metricas['mensajes']} mensajes): hay poco de dónde sacar hallazgos. "
                      "Si puedes, escríbeles de nuevo antes de enviar.")
    if fuente_nivel != "clasificacion":
        avisos.append("El nivel se estimó con los tiempos de respuesta: este número no tiene clasificación en Análisis.")
    if sin_ia:
        avisos.append("La IA no respondió: el borrador se armó con los hallazgos detectados.")
    if notas["completadas"]:
        avisos.append(f"La IA dejó {notas['completadas']} hallazgo(s) sin redactar; se completaron con los detectados.")
    if quitadas:
        avisos.append(f"Se quitaron etiquetas que no coincidían con lo medido: {', '.join('«' + q + '»' for q in quitadas)}.")
    if sin_lugar or notas["marcas_invalidas"]:
        avisos.append("Algunos hallazgos no tienen su propio mensaje marcado en la conversación: elígelo en «Se ve en».")
    if recortados:
        avisos.append(f"{recortados} texto(s) se recortaron con «…» para que quepan: revísalos.")
    # El scraper a veces toma el logo de un cliente o socio que aparece en su sitio (Gas de
    # Tlalnepantla salió con el de CEMEX, 2026-10-20).
    avisos.append("Revisa el logo: se tomó de su sitio web y a veces es de otra marca." if logo
                  else "Sin logo (no se encontró o no se pudo descargar): se muestra el nombre.")
    resuelve = {o["ventaja"]: str(k) for k, o in enumerate(hallazgos["oportunidades"], 1) if o.get("ventaja")}
    capa = {
        "industria": industria,
        "cliente": cliente,
        "evaluacion": {"fecha": formato.fecha_evaluacion(ahora or datetime.now(timezone.utc)),
                       "periodo": formato.periodo(metricas["inicio"], metricas["fin"])},
        "nivel": {"hoy": nivel, "sintesis": sintesis_html(hallazgos["sintesis_titular"], hallazgos["sintesis_texto"])},
        "fortalezas": [{"titulo": f["titulo"], "texto": f["texto"]} for f in hallazgos["fortalezas"]],
        "oportunidades": [{k: o[k] for k in ("titulo", "dato", "vimos", "oportunidad")} for o in hallazgos["oportunidades"]],
        "resuelve": resuelve,
        "conversacion": {"real": items},
    }
    # Los hechos van al editor: "Partir de un hallazgo detectado" llena una tarjeta con ellos.
    campos = {"oportunidades": ("id", "tipo", "dato", "mensaje", "titulo", "vimos", "oportunidad", "ventaja"),
              "fortalezas": ("id", "tipo", "mensaje", "titulo", "texto")}
    # El editor muestra de qué clasificación salió el nivel y deja volver a ella si se cambia.
    info = {"origen": origen, "nivel_fuente": fuente_nivel, "categoria": (verdict or {}).get("category"),
            "es_ia": bool((verdict or {}).get("is_ai")), "nivel_analisis": nivel if fuente_nivel == "clasificacion" else None,
            "avisos": avisos, "mensajes": metricas["mensajes"],
            "hechos": {lista: [{k: h[k] for k in claves} for h in hechos[lista]] for lista, claves in campos.items()}}
    return capa, info
