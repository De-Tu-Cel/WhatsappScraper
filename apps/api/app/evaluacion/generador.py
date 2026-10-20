"""Generador de la "Evaluación del canal WhatsApp" — De Tu Cel (puerto de generar.js).

Combina tres capas de configuración y produce un HTML autocontenido:
  config/base.json               textos y marca De Tu Cel (comunes a todos)
  config/industrias/<giro>.json  ventajas, demo, dashboard y referencias del giro
  capa del cliente (dict)        logo, conversación real, hallazgos, nivel (armador.py)

Produce exactamente el mismo HTML que generar.js con las mismas entradas
(tests/test_evaluacion.py lo compara byte por byte), así el diseño se sigue
trabajando en plantilla.html y en los JSON sin tocar este código.
"""
import base64
import json
import logging
import re
from pathlib import Path

log = logging.getLogger(__name__)
RAIZ = Path(__file__).resolve().parent
MIME = {".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".svg": "image/svg+xml", ".woff2": "font/woff2"}
_RUTA = re.compile(r"\{\{\s*([\w.]+)\s*\}\}")
_FALTA = object()


# ── combinación de capas: los objetos se mezclan, los arreglos se reemplazan ──
def mezclar(a, b):
    if not (isinstance(a, dict) and isinstance(b, dict)):
        return a if b is _FALTA else b
    r = dict(a)
    for k, v in b.items():
        r[k] = mezclar(a.get(k, _FALTA), v)
    return r


# ── {{ruta.al.valor}} dentro de cualquier texto ──
def obtener(obj, ruta):
    for k in ruta.split("."):
        if obj is None or obj is _FALTA:
            return _FALTA
        if isinstance(obj, dict):
            obj = obj.get(k, _FALTA)
        elif isinstance(obj, list) and k.isdigit():
            obj = obj[int(k)] if int(k) < len(obj) else _FALTA
        else:
            return _FALTA
    return obj


def _js_str(v) -> str:
    """String(v) de JavaScript."""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, list):
        return ",".join("" if x is None else _js_str(x) for x in v)
    if isinstance(v, dict):
        return "[object Object]"
    return str(v)


def interpolar(valor, ctx, pila=0):
    if isinstance(valor, str):
        def sustituir(m):
            v = obtener(ctx, m.group(1))
            if v is None or v is _FALTA:
                log.warning("Evaluación: falta el valor {{%s}}", m.group(1))
                return ""
            return interpolar(_js_str(v), ctx, pila + 1) if pila < 5 else _js_str(v)
        return _RUTA.sub(sustituir, valor)
    if isinstance(valor, list):
        return [interpolar(v, ctx, pila) for v in valor]
    if isinstance(valor, dict):
        return {k: interpolar(v, ctx, pila) for k, v in valor.items()}
    return valor


# ── assets/… → data URI para que el HTML sea un solo archivo ──
def a_data_uri(ruta: str, raices=()) -> str:
    for raiz in (RAIZ, *raices):
        abs_ = Path(raiz) / ruta
        if abs_.is_file():
            mime = MIME.get(abs_.suffix.lower(), "application/octet-stream")
            return f"data:{mime};base64,{base64.b64encode(abs_.read_bytes()).decode('ascii')}"
    log.warning("Evaluación: no existe %s", ruta)
    return ruta


def incrustar(valor, raices=()):
    if isinstance(valor, str):
        return a_data_uri(valor, raices) if valor.startswith("assets/") else valor
    if isinstance(valor, list):
        return [incrustar(v, raices) for v in valor]
    if isinstance(valor, dict):
        return {k: incrustar(v, raices) for k, v in valor.items()}
    return valor


def leer_json(ruta) -> dict:
    return json.loads(Path(ruta).read_text(encoding="utf-8"))


def _esc_attr(s: str) -> str:
    return s.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")


def industrias() -> list[str]:
    return sorted(p.stem for p in (RAIZ / "config" / "industrias").glob("*.json"))


# ── validación mínima para detectar errores comunes ──
def validar(c: dict) -> list[str]:
    err = []
    cliente, nivel, conv = c.get("cliente") or {}, c.get("nivel") or {}, c.get("conversacion") or {}
    if not cliente.get("nombre"):
        err.append("cliente.nombre es obligatorio")
    if not nivel.get("hoy"):
        err.append("nivel.hoy es obligatorio")
    escala = nivel.get("escala")
    if escala and (nivel.get("hoy", 0) > len(escala) or nivel.get("meta", 0) > len(escala)):
        err.append("nivel.hoy/meta fuera de la escala")
    if not conv.get("real"):
        err.append("conversacion.real es obligatoria")
    if not conv.get("demo"):
        err.append("conversacion.demo es obligatoria (normalmente viene de la industria)")
    n_op, n_fz = len(c.get("oportunidades") or []), len(c.get("fortalezas") or [])
    for m in conv.get("real") or []:
        pin = m.get("pin") if isinstance(m, dict) else None
        if not pin:
            continue
        if re.fullmatch(r"v\d+", pin) and int(pin[1:]) > n_fz:
            err.append(f'pin "{pin}" sin fortaleza correspondiente')
        if re.fullmatch(r"\d+", pin) and int(pin) > n_op:
            err.append(f'pin "{pin}" sin oportunidad correspondiente')
    ids = {v.get("id") for v in c.get("ventajas") or []}
    for m in conv.get("demo") or []:
        if isinstance(m, dict) and m.get("pin") and m["pin"] not in ids:
            err.append(f'pin de demo "{m["pin"]}" sin ventaja con ese id')
    return err


class ConfiguracionInvalida(ValueError):
    pass


def configuracion(cliente_cfg: dict, *, industria: dict | None = None) -> dict:
    """Las tres capas combinadas, interpoladas y validadas (sin incrustar imágenes)."""
    base = leer_json(RAIZ / "config" / "base.json")
    cliente = {k: v for k, v in cliente_cfg.items() if k != "industria"}  # "industria" del cliente es solo la clave del giro
    if industria is None:
        clave = cliente_cfg.get("industria")
        if clave not in industrias():
            raise ConfiguracionInvalida(f"industria desconocida: {clave!r}")
        industria = leer_json(RAIZ / "config" / "industrias" / f"{clave}.json")
    c = mezclar(mezclar(base, industria), cliente)
    # El cliente decide qué oportunidad resuelve cada ventaja: "resuelve": {"b1": "2", ...}
    if c.get("resuelve") and c.get("ventajas"):
        c["ventajas"] = [{**v, "resuelve": c["resuelve"][v["id"]]} if c["resuelve"].get(v.get("id")) else v
                         for v in c["ventajas"]]
    c = interpolar(c, c)
    errores = validar(c)
    if errores:
        raise ConfiguracionInvalida("Configuración inválida:\n  - " + "\n  - ".join(errores))
    return c


def generar_evaluacion(cliente_cfg: dict, *, incrustar_assets: bool = True, industria: dict | None = None,
                       raices_assets=()) -> str:
    """HTML final, autocontenido (imágenes y fuente incrustadas) salvo incrustar_assets=False."""
    c = configuracion(cliente_cfg, industria=industria)
    plantilla = (RAIZ / "plantilla.html").read_text(encoding="utf-8")
    datos = incrustar(c, raices_assets) if incrustar_assets else c

    def meta(m):  # metadatos del <head> (WhatsApp/Facebook leen el título al compartir)
        v = obtener(c, m.group(1))
        return _esc_attr("" if v is None or v is _FALTA else _js_str(v))
    html = _RUTA.sub(meta, plantilla)
    # Los datos para el script; "</" se escapa para no cerrar la etiqueta <script>.
    datos_json = json.dumps(datos, ensure_ascii=False, separators=(",", ":"))
    datos_json = datos_json.replace("</", "<\\/").replace(" ", " ").replace(" ", " ")
    html = html.replace("/*__CONFIG__*/null", datos_json, 1)
    if incrustar_assets:
        html = re.sub(r"url\((assets/[^)]+)\)", lambda m: f"url({a_data_uri(m.group(1), raices_assets)})", html)
    return html
