"""
Simulador de diálogo Andy ↔ Empresa — sin tocar WhatsApp real.
Ambos lados son LLM o respuestas scriptadas.

Modos de empresa:
  human       — humano real respondiendo (LLM)
  ivr_num     — bot IVR con opciones numeradas
  ivr_letters — bot IVR con opciones por letras (estilo *A* *B* *C*)
  ack         — mensaje automático / acuse de recibo (ticket)
  ai_sofia    — IA rival que se presenta como "Sofía" o "AMAIA"
  spam_check  — humano que sospecha spam y confronta

Uso:
  python test_dialogue_simulator.py --mode human --industry "Gas LP" --city Queretaro
  python test_dialogue_simulator.py --mode ivr_num
  python test_dialogue_simulator.py --mode ai_sofia
  python test_dialogue_simulator.py --mode spam_check
  python test_dialogue_simulator.py --all   (corre todos los modos en secuencia)
"""
import sys
import argparse
import textwrap

sys.path.insert(0, r'C:\Repos\WhatsappScraper\backEnd\app')
sys.path.insert(0, r'C:\Repos\WhatsappScraper\backEnd')

from ai_followup import _call_llm_for_reply, _generate_persona_seed
from llm import call_llm

# ─────────────────────────────────────────────
# Respuestas scriptadas para bots IVR y ACK
# ─────────────────────────────────────────────

IVR_NUM_SCRIPT = [
    ("Bienvenido a Gas Express. Por favor elige una opción:\n"
     "1 - Pedido nuevo\n"
     "2 - Estado de pedido\n"
     "3 - Hablar con un asesor\n"
     "4 - Horarios y precios"),
    # Siguiente turno depende de lo que diga Andy — manejado en loop
]

IVR_LETTERS_SCRIPT = [
    ("¡Hola! Bienvenido a Seguros Atlas. Elige tu opción:\n"
     "*A* - Cotizar seguro\n"
     "*B* - Renovar póliza\n"
     "*C* - Reportar siniestro\n"
     "*D* - Hablar con agente\n"
     "*E* - Otro"),
    "Conectando con un agente, un momento por favor.",
    "Hola, soy María del equipo de ventas. ¿En qué te ayudo?",
]

ACK_SCRIPT = [
    ("Tu mensaje ha sido recibido. Número de folio: #92847.\n"
     "Un asesor te contactará en un lapso de 24 horas en horario hábil.\n"
     "Horario de atención: Lunes a Viernes 9am-6pm.\n"
     "Gracias por contactarnos. — Equipo de Soporte Grupo Hermes"),
]

AI_SOFIA_SCRIPT = [
    "Hola! Soy Sofía, asistente virtual de Inmobiliaria del Valle 👋 ¿Con quién tengo el gusto?",
    "Mucho gusto, Andrés! ¿Estás buscando comprar, vender o rentar una propiedad?",
    "Entendido. Para conectarte con un asesor especializado necesito algunos datos. ¿Cuál es tu número de teléfono?",
    "Gracias! Un asesor se pondrá en contacto contigo a la brevedad. ¿Hay algo más en lo que pueda ayudarte?",
]

# ─────────────────────────────────────────────
# LLM para empresa humana y humano suspicaz
# ─────────────────────────────────────────────

def _company_reply(turns: list, company_name: str, industry: str, city: str) -> str:
    """Simula respuesta de un empleado/dueño humano de la empresa."""
    system = (
        f"Eres un empleado o dueño de '{company_name}', negocio de {industry} en {city}. "
        f"Un cliente potencial te escribió por WhatsApp. Responde de forma natural, breve y directa — "
        f"como lo haría alguien respondiendo desde su teléfono. "
        f"Máximo 2-3 oraciones. Sin formalidades excesivas. En español mexicano casual. "
        f"Si te piden precio, dalo (invéntalo de forma razonable para el giro). "
        f"Si piden dirección, inventa una plausible en {city}. "
        f"Avanza la conversación de forma natural hacia cerrar la venta o dar la info que piden."
    )
    msgs = [{"role": "system", "content": system}]
    for t in turns:
        msgs.append({"role": t["role"], "content": t["content"]})
    try:
        return call_llm(msgs, max_tokens=80, temperature=0.75)
    except Exception as e:
        return f"(error empresa LLM: {e})"


def _suspicious_human_reply(turns: list, turn_num: int) -> str:
    """Simula un humano que sospecha spam."""
    suspicion_arc = [
        "Oye honestamente esto parece un mensaje de spam. ¿Quién eres realmente?",
        "Es que recibimos muchos mensajes así y normalmente son bots o gente vendiendo algo que no pedimos.",
        "Ok... ¿y exactamente qué necesitas de nosotros?",
        "Mira, si eres un cliente genuino puedes pasar a nuestra sucursal o llamarnos. ¿Te puedo dar el número?",
        "Está bien. Cuál sería tu dirección para la entrega entonces?",
    ]
    if turn_num < len(suspicion_arc):
        return suspicion_arc[turn_num]
    # Después de 5 turnos, el humano se convence y ayuda
    system = (
        "Eres un empleado de una ferretería. Al principio desconfiabas de este cliente pero ya te convenciste. "
        "Responde como alguien que ya confía y quiere cerrar la venta. Breve, español casual."
    )
    msgs = [{"role": "system", "content": system}]
    for t in turns:
        msgs.append({"role": t["role"], "content": t["content"]})
    try:
        return call_llm(msgs, max_tokens=60, temperature=0.7)
    except Exception:
        return "Ok, ¿qué cantidad de material necesitas?"


# ─────────────────────────────────────────────
# Runner principal
# ─────────────────────────────────────────────

def run_dialogue(mode: str, industry: str = "Gas LP", city: str = "Queretaro",
                 company_name: str = None, max_turns: int = 8):
    if not company_name:
        company_name = {
            "human":       "Gas Express",
            "ivr_num":     "Gas Express Automatizado",
            "ivr_letters": "Seguros Atlas",
            "ack":         "Grupo Hermes Soporte",
            "ai_sofia":    "Inmobiliaria del Valle",
            "spam_check":  "Ferretería del Norte",
        }.get(mode, "Empresa Demo")

    initial_msg = {
        "human":       "buenas, vi que se dedican a gas lp, tienen servicio a domicilio?",
        "ivr_num":     "buenas, vi que se dedican a gas lp, tienen servicio a domicilio?",
        "ivr_letters": "hola, busco info sobre seguros, me pueden orientar?",
        "ack":         "hola, quisiera saber mas sobre sus servicios",
        "ai_sofia":    "buenas, vi que tienen propiedades en renta, me pueden dar info?",
        "spam_check":  "oye vi que tienen materiales de construccion, manejan tuberia?",
    }.get(mode, "hola, tienen servicio disponible?")

    industry_by_mode = {
        "ivr_letters": "Seguros / Finanzas",
        "ai_sofia":    "Inmobiliaria / Bienes Raíces",
        "spam_check":  "Ferretería / Construcción",
    }
    _industry = industry_by_mode.get(mode, industry)
    _city = {"ivr_letters": "CDMX", "ai_sofia": "CDMX", "spam_check": "Monterrey"}.get(mode, city)

    persona_seed = _generate_persona_seed(_industry, _city)

    ctx = {
        "company_name":    company_name,
        "industry":        _industry,
        "city":            _city,
        "initial_message": initial_msg,
        "company_context": f"Negocio de {_industry} en {_city}.",
        "extra_block":     "",
        "persona_seed":    persona_seed,
    }

    label_map = {
        "human":       "humano",
        "ivr_num":     "IVR numérico",
        "ivr_letters": "IVR letras (*A*/*B*...)",
        "ack":         "acuse de recibo (ticket)",
        "ai_sofia":    "IA rival (Sofía)",
        "spam_check":  "humano suspicaz (anti-spam)",
    }

    print(f"\n{'='*65}")
    print(f"  MODO: {label_map.get(mode, mode).upper()}")
    print(f"  Empresa: {company_name} | {_industry} | {_city}")
    print(f"  Persona seed: {persona_seed}")
    print(f"{'='*65}\n")
    print(f"  [Andy inicia]: \"{initial_msg}\"\n")

    andy_turns = []
    # Seed con el mensaje inicial de Andy como outbound
    andy_turns.append({"role": "assistant", "content": initial_msg})

    script_idx = 0
    suspicion_turn = 0

    for turn in range(max_turns):
        # ── Empresa responde ──
        if mode == "ivr_num":
            if script_idx == 0:
                empresa_msg = IVR_NUM_SCRIPT[0]
            else:
                # Responde según lo que Andy eligió — simula que avanzó el menú
                empresa_msg = "Conectando con un asesor... Hola! Soy Carlos, ¿en qué te ayudo?"
                if turn >= 2:
                    empresa_msg = "Perfecto, cuál es tu dirección para la entrega del gas?"
            script_idx += 1

        elif mode == "ivr_letters":
            if script_idx < len(IVR_LETTERS_SCRIPT):
                empresa_msg = IVR_LETTERS_SCRIPT[script_idx]
                script_idx += 1
            else:
                empresa_msg = "¿Cuánto cubre tu póliza actual?"

        elif mode == "ack":
            if script_idx < len(ACK_SCRIPT):
                empresa_msg = ACK_SCRIPT[script_idx]
                script_idx += 1
            elif turn == 1:
                empresa_msg = "Hola Andrés, soy Karina de soporte. Vi tu mensaje. ¿En qué te podemos ayudar?"
            else:
                empresa_msg = _company_reply(andy_turns, company_name, _industry, _city)

        elif mode == "ai_sofia":
            if script_idx < len(AI_SOFIA_SCRIPT):
                empresa_msg = AI_SOFIA_SCRIPT[script_idx]
                script_idx += 1
            else:
                empresa_msg = "¿Hay algo más en lo que pueda orientarte? 😊"

        elif mode == "spam_check":
            empresa_msg = _suspicious_human_reply(andy_turns, suspicion_turn)
            suspicion_turn += 1

        else:  # human
            empresa_msg = _company_reply(andy_turns, company_name, _industry, _city)

        andy_turns.append({"role": "user", "content": empresa_msg})

        wrapped = textwrap.fill(empresa_msg, width=58, subsequent_indent="              ")
        print(f"  Empresa     : \"{wrapped}\"")

        # ── Andy responde ──
        is_first_real = (turn == 0)
        andy_resp = _call_llm_for_reply(andy_turns, ctx, is_cold_start=is_first_real)
        if not andy_resp:
            print("  Andy        : (sin respuesta — condición de cierre silencioso)\n")
            break

        fin = "[FIN]" in andy_resp
        clean = andy_resp.replace("[FIN]", "").strip()
        label = "Andy [FIN]  " if fin else "Andy        "
        wrapped_andy = textwrap.fill(clean, width=58, subsequent_indent="              ")
        print(f"  {label}: \"{wrapped_andy}\"\n")

        andy_turns.append({"role": "assistant", "content": clean})

        if fin:
            print("  ── conversación cerrada por Andy ──\n")
            break

    print(f"{'='*65}\n")


# ─────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Simulador Andy ↔ Empresa")
    parser.add_argument("--mode", default="human",
                        choices=["human", "ivr_num", "ivr_letters", "ack", "ai_sofia", "spam_check"],
                        help="Tipo de empresa a simular")
    parser.add_argument("--industry", default="Gas LP")
    parser.add_argument("--city", default="Queretaro")
    parser.add_argument("--turns", type=int, default=8)
    parser.add_argument("--all", action="store_true", dest="run_all",
                        help="Corre todos los modos en secuencia")
    args = parser.parse_args()

    if args.run_all:
        for m in ["human", "ivr_num", "ivr_letters", "ack", "ai_sofia", "spam_check"]:
            run_dialogue(m, args.industry, args.city, max_turns=args.turns)
    else:
        run_dialogue(args.mode, args.industry, args.city, max_turns=args.turns)
