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
import json
import logging
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
_TELEFONO = re.compile(r"(?<!\d)(?:\+?52[\s.-]?)?(?:\(?\d{2,3}\)?[\s.-]?)\d{3,4}[\s.-]?\d{4}(?!\d)")
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
def construir_conversacion(thread: list) -> tuple[list, list, dict]:
    """(mensajes para la plantilla, renglones numerados para el LLM, métricas)."""
    items, renglones = [], []
    metricas = {"primera_respuesta_s": None, "esperas": [], "sin_respuesta": [], "telefonos": [],
                "inicio": None, "fin": None, "mensajes": 0}
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
        if sale:
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
                    numero = digitos if len(digitos) > 10 else "52" + digitos
                    metricas["telefonos"].append({"telefono": formato.telefono(numero), "indice": indice})
    if pendiente:
        items.append({"tipo": "nota", "texto": "Sin respuesta en el chat"})
        metricas["sin_respuesta"].append(pendiente[1])
    return items, renglones, metricas


# ── nivel ──────────────────────────────────────────────────────────────────────
def nivel_desde(verdict: dict | None, metricas: dict) -> tuple[int, str]:
    if verdict and verdict.get("category") in NIVEL_POR_CATEGORIA:
        return NIVEL_POR_CATEGORIA[verdict["category"]], "clasificacion"
    if metricas.get("primera_respuesta_s") is None:
        return 1, "reglas"  # nunca contestaron
    return (3 if metricas["primera_respuesta_s"] <= 10 else 2), "reglas"  # al instante = mensaje automático


def sintesis_html(titular: str, texto: str) -> str:
    """La plantilla pinta la síntesis con innerHTML: solo nuestras <b>, el resto escapado."""
    return f"<b>{html.escape(formato.texto_plano(titular, LIMITES['sintesis_titular']))}</b> " \
           f"{html.escape(formato.texto_plano(texto, LIMITES['sintesis_texto']))}"


# ── hallazgos por reglas (respaldo) ────────────────────────────────────────────
def hallazgos_por_reglas(items: list, metricas: dict, nivel: int) -> dict:
    negocio = [i for i, m in enumerate(items) if m["tipo"] == "negocio"]
    fortalezas, oportunidades = [], []
    rapida = metricas.get("primera_respuesta_s")
    if rapida is not None and rapida <= 60 and negocio:
        fortalezas.append({"titulo": f"Respuesta en {formato.duracion(rapida)}", "texto": "Contestan casi al instante.",
                           "mensaje": negocio[0]})
    menu = next((i for i in negocio if len(re.findall(r"(?m)^\s*(?:\d+[.)]|[🔷🔹▪•*-]|\d️⃣)", items[i]["texto"].replace("<br>", "\n"))) >= 2), None)
    if menu is not None:
        fortalezas.append({"titulo": "Menú que orienta", "texto": "Guía al cliente a su opción.", "mensaje": menu})
    if nivel in (2, 3) and len(negocio) > 1:
        fortalezas.append({"titulo": "Trato personal", "texto": "Una persona atiende el chat.", "mensaje": negocio[-1]})
    if negocio and len(fortalezas) < 3:
        fortalezas.append({"titulo": "Canal activo", "texto": "El WhatsApp sí recibe mensajes.", "mensaje": negocio[0]})

    if metricas["sin_respuesta"]:
        i = metricas["sin_respuesta"][0]
        oportunidades.append({"titulo": "Una pregunta quedó sin respuesta", "dato": "Sin respuesta",
                              "vimos": f"El mensaje de las {items[i]['hora']} no tuvo respuesta.",
                              "oportunidad": "Resolver al momento las dudas frecuentes.", "mensaje": i, "ventaja": "b2"})
    if metricas["esperas"]:
        e = max(metricas["esperas"], key=lambda x: x["segundos"])
        horas = f"{int(e['segundos'] // 3600)} h" if e["segundos"] >= 3600 else formato.duracion(e["segundos"])
        oportunidades.append({"titulo": "El cliente espera la respuesta", "dato": f"{horas} de espera",
                              "vimos": f"Escribimos a las {formato.hora(e['desde'])} y respondieron a las {formato.hora(e['hasta'])}"
                                       f"{' del día siguiente' if formato.a_mx(e['hasta']).date() != formato.a_mx(e['desde']).date() else ''}.",
                              "oportunidad": "Atender y tomar pedidos las 24 horas.", "mensaje": e["indice"], "ventaja": "b1"})
    if metricas["telefonos"]:
        t = metricas["telefonos"][0]
        oportunidades.append({"titulo": "El pedido sale de WhatsApp", "dato": "Pedido por llamada",
                              "vimos": f"Para pedir, nos dieron el teléfono {t['telefono']}.",
                              "oportunidad": "Que pida y pague en la misma conversación.", "mensaje": t["indice"], "ventaja": "b3"})
    extra = [{"titulo": "El pedido no se cierra en el chat", "dato": "Sin pedido en chat",
              "vimos": "La plática no llegó a tomar el pedido.", "oportunidad": "Que pida y pague en la misma conversación.",
              "mensaje": None, "ventaja": "b3"},
             {"titulo": "No hay seguimiento al cliente", "dato": "Sin seguimiento",
              "vimos": "Después de la plática nadie dio seguimiento.", "oportunidad": "Dar seguimiento y medir la satisfacción.",
              "mensaje": None, "ventaja": "b7"},
             {"titulo": "El cliente no queda reconocido", "dato": "Sin historial",
              "vimos": "Cada vez hay que repetir los datos.", "oportunidad": "Reconocer el número y recordar su dirección.",
              "mensaje": None, "ventaja": "b4"}]
    usadas = {o["ventaja"] for o in oportunidades}
    for o in extra:
        if len(oportunidades) >= 3:
            break
        if o["ventaja"] not in usadas:
            oportunidades.append(o)
            usadas.add(o["ventaja"])
    titular, texto = SINTESIS[nivel]
    return {"sintesis_titular": titular, "sintesis_texto": texto, "fortalezas": fortalezas[:3],
            "oportunidades": oportunidades[:3]}


# ── hallazgos con el LLM ───────────────────────────────────────────────────────
_PROMPT = """Eres analista de De Tu Cel. Escribimos al WhatsApp de "{empresa}" ({giro}) como si fuéramos un cliente nuevo.
Esta es la conversación real, numerada. Solo puedes afirmar lo que se ve en ella.

{conversacion}

Datos medidos: {datos}
Clasificación del canal: {clasificacion}. Nivel {nivel} de 5 ({nombre_nivel}).

Redacta en español de México, tono profesional y cálido. REGLAS:
- Todo debe salir de la conversación y de los datos medidos de arriba. Si algo no pasó, no lo digas.
- Un mensaje que llega en 10 s o menos es automático, no una persona: no lo presentes como atención humana.
- Respeta el máximo de PALABRAS de cada campo: es una hoja impresa y no cabe más. Sin puntos suspensivos.
Campos:
- "sintesis_titular": diagnóstico del canal en una frase (máx. {sintesis_titular} palabras).
- "sintesis_texto": qué le falta para ser una experiencia de compra (máx. {sintesis_texto} palabras).
- "fortalezas": exactamente 3 cosas que YA hace bien el negocio en esta conversación. "titulo" tipo
  etiqueta (máx. {f_titulo} palabras), "texto" (máx. {f_texto} palabras), "mensaje": el número [n] de un mensaje del Negocio que lo muestra.
- "oportunidades": exactamente 3, distintas, de la más grave a la menos. "titulo" (máx. {o_titulo} palabras);
  "dato": etiqueta con el hecho verificable (máx. {o_dato} palabras): una espera medida (p. ej. "N h de espera"),
  "Sin respuesta" SOLO si un mensaje nuestro quedó sin contestar, "Pedido por llamada" SOLO si nos mandaron
  a llamar o nos dieron un teléfono para pedir; si no, una etiqueta propia del hecho;
  "vimos": lo que pasó, con su hora o fecha (máx. {o_vimos} palabras); "oportunidad": cómo se resuelve (máx. {o_oportunidad} palabras);
  "mensaje": el número [n] donde se ve; "ventaja": la que lo resuelve, una distinta por oportunidad, de: {ventajas}.
Responde SOLO JSON: {{"sintesis_titular": "", "sintesis_texto": "", "fortalezas": [{{"titulo": "", "texto": "", "mensaje": 0}}], "oportunidades": [{{"titulo": "", "dato": "", "vimos": "", "oportunidad": "", "mensaje": 0, "ventaja": ""}}]}}"""


def hallazgos_con_llm(empresa, giro, renglones, metricas, verdict, nivel, escala, ventajas) -> dict:
    from app.config import CLASSIFIER_MODEL
    from app.llm import PRIORITY_BATCH, call_llm
    primera = metricas["primera_respuesta_s"]
    datos = {
        "primera respuesta": ("nunca" if primera is None else
                              f"{formato.duracion(primera)}{' (automática: llegó al instante)' if primera <= 10 else ''}"),
        "esperas de 1 h o más": [f"{formato.duracion(e['segundos'])} (de {formato.hora(e['desde'])} a {formato.hora(e['hasta'])})"
                                 for e in metricas["esperas"]] or "ninguna",
        "mensajes nuestros que quedaron sin respuesta": [f"[{i}]" for i in metricas["sin_respuesta"]] or "ninguno",
        "teléfonos que dio el negocio": [t["telefono"] for t in metricas["telefonos"]] or "ninguno",
    }
    clasificacion = (verdict or {}).get("notes") or (verdict or {}).get("category") or "sin clasificación"
    prompt = _PROMPT.format(
        empresa=empresa, giro=giro, conversacion="\n".join(renglones).replace("{", "(").replace("}", ")"),
        datos=json.dumps(datos, ensure_ascii=False), clasificacion=clasificacion, nivel=nivel,
        nombre_nivel=escala[nivel - 1]["nombre"],
        ventajas="; ".join(f'{v["id"]} = {v["titulo"]}' for v in ventajas if v["id"] != "b5"), **PALABRAS)
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


def depurar_hallazgos(datos: dict, items: list, ventajas_ids: set, respaldo: dict) -> tuple[dict, list]:
    """Recorta a los límites, valida pines y ventajas; lo que no cuadra se toma del respaldo."""
    avisos = []
    tipos = {i: m["tipo"] for i, m in enumerate(items)}

    def pin_valido(n, permitidos, titulo=""):
        if isinstance(n, int) and tipos.get(n) in permitidos:
            return True
        if n is not None:
            avisos.append(f"El modelo señaló un mensaje que no corresponde para «{formato.texto_plano(titulo, 40)}»: "
                          "quedó sin marca en la conversación.")
        return False

    fort = []
    for f in (datos.get("fortalezas") or [])[:3]:
        if not isinstance(f, dict) or not f.get("titulo"):
            continue
        fort.append({"titulo": formato.texto_plano(f["titulo"], LIMITES["f_titulo"]),
                     "texto": formato.texto_plano(f.get("texto"), LIMITES["f_texto"]),
                     "mensaje": f.get("mensaje") if pin_valido(f.get("mensaje"), {"negocio"}, f["titulo"]) else None})
    oport, usadas = [], set()
    for o in (datos.get("oportunidades") or [])[:3]:
        if not isinstance(o, dict) or not o.get("titulo"):
            continue
        ventaja = o.get("ventaja") if o.get("ventaja") in ventajas_ids and o.get("ventaja") not in usadas else None
        if not ventaja:  # inválida o repetida: se deduce del texto (sin repetir)
            deducida = _ventaja_por_texto(o)
            ventaja = deducida if deducida in ventajas_ids and deducida not in usadas else None
        if ventaja:
            usadas.add(ventaja)
        oport.append({"titulo": formato.texto_plano(o["titulo"], LIMITES["o_titulo"]),
                      "dato": formato.texto_plano(o.get("dato"), LIMITES["o_dato"]),
                      "vimos": formato.texto_plano(o.get("vimos"), LIMITES["o_vimos"]),
                      "oportunidad": formato.texto_plano(o.get("oportunidad"), LIMITES["o_oportunidad"]),
                      "mensaje": o.get("mensaje") if pin_valido(o.get("mensaje"), {"negocio", "cliente"}, o["titulo"]) else None,
                      "ventaja": ventaja})
    if len(fort) < 3:
        avisos.append("Faltaron fortalezas del modelo; se completaron por reglas.")
        fort += [f for f in respaldo["fortalezas"] if f["titulo"] not in {x["titulo"] for x in fort}][:3 - len(fort)]
    if len(oport) < 3:
        avisos.append("Faltaron oportunidades del modelo; se completaron por reglas.")
        # Sin repetir el tema de una que ya está (misma ventaja o mismo dato).
        datos_usados = {o["dato"].lower() for o in oport}
        oport += [o for o in respaldo["oportunidades"]
                  if o.get("ventaja") not in usadas and o["dato"].lower() not in datos_usados][:3 - len(oport)]
    titular = datos.get("sintesis_titular") or respaldo["sintesis_titular"]
    texto = datos.get("sintesis_texto") or respaldo["sintesis_texto"]
    return {"sintesis_titular": titular, "sintesis_texto": texto, "fortalezas": fort, "oportunidades": oport}, avisos


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
    que dieran teléfono). Si no cuadra, se quita la etiqueta y se avisa al revisor."""
    avisos = []
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
            avisos.append(f"Se quitó la etiqueta «{o['dato']}» de «{o['titulo']}»: no coincide con lo medido en la conversación.")
            o["dato"] = ""
    return avisos


def poner_pines(items: list, hallazgos: dict) -> list:
    """Un pin por mensaje: v1..v3 para lo que funciona, 1..3 para oportunidades."""
    avisos = []
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
                avisos.append(f"El hallazgo {prefijo}{k} quedó sin marca en la conversación (no hay mensaje libre).")
            else:
                items[j]["pin"] = f"{prefijo}{k}"
    return avisos


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
    items, renglones, metricas = construir_conversacion(thread)
    if not metricas["mensajes"]:
        raise ValueError("No hay conversación con ese número para evaluar.")
    nivel, fuente_nivel = nivel_desde(verdict, metricas)
    respaldo = hallazgos_por_reglas(items, metricas, nivel)
    ventajas_ids = {v["id"] for v in giro.get("ventajas", [])}
    avisos, origen = [], "reglas"
    hallazgos = respaldo
    if usar_llm:
        try:
            crudo = hallazgos_con_llm(company.get("name") or "la empresa", giro["industria"]["plural"], renglones,
                                      metricas, verdict, nivel, escala, giro.get("ventajas", []))
            for _intento in range(2):  # mejor una frase completa más corta que una cortada con "…"
                largos = _excedidos(crudo)
                if not largos:
                    break
                try:
                    aplicar_acortados(crudo, largos, acortar_con_llm(largos))
                except Exception as exc:
                    log.info("Evaluación: no se pudieron acortar textos (%s)", exc)
                    break
            hallazgos, avisos = depurar_hallazgos(crudo, items, ventajas_ids, respaldo)
            avisos += verificar_datos(hallazgos["oportunidades"], metricas)
            recortados = len(_excedidos(crudo))
            if recortados:
                avisos.append(f"{recortados} texto(s) se recortaron con «…» para que quepan: revísalos.")
            origen = "llm"
        except Exception as exc:
            log.warning("Evaluación %s: el modelo no generó hallazgos (%s); se usan reglas", company.get("name"), exc)
            avisos.append("El modelo no respondió; el borrador se armó por reglas.")
    avisos += poner_pines(items, hallazgos)
    nombre = company.get("name") or company.get("domain") or "La empresa"
    cliente = {"nombre": nombre, "logoAlt": nombre, "telefono": formato.telefono(numero),
               "nombreBot": formato.texto_plano(whatsapp_name, 40) or nombre}
    logo = bajar_logo(company.get("logo_url"))
    if logo:
        cliente["logo"] = logo
        # El scraper a veces toma el logo de un cliente o socio que aparece en su sitio
        # (Gas de Tlalnepantla salió con el de CEMEX, 2026-10-20).
        avisos.append("Revisa el logo: se tomó automáticamente de su sitio web y puede no ser el suyo.")
    else:
        avisos.append("Sin logo (no se encontró o no se pudo descargar): se muestra el nombre.")
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
    info = {"origen": origen, "nivel_fuente": fuente_nivel, "categoria": (verdict or {}).get("category"),
            "avisos": avisos, "mensajes": metricas["mensajes"]}
    return capa, info
