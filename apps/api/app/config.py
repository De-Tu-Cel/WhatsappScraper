# config.py
import os
from pathlib import Path
from dotenv import load_dotenv

# Cargar variables de entorno — busca .env junto a este archivo primero, luego sube
load_dotenv(dotenv_path=Path(__file__).parent.parent / '.env', override=True)

# MongoDB
MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
DATABASE_NAME = os.getenv("DATABASE_NAME", "commercial")

# WhatsApp Business API
WHATSAPP_PHONE_NUMBER_ID = os.getenv("WHATSAPP_PHONE_NUMBER_ID", "")
WHATSAPP_ACCESS_TOKEN = os.getenv("WHATSAPP_ACCESS_TOKEN", "")
WHATSAPP_TEMPLATE = os.getenv("WHATSAPP_TEMPLATE", "hello_world")
WHATSAPP_LANG = os.getenv("WHATSAPP_LANG", "en_US")

# Número de fallback (si no se encuentra WhatsApp en el sitio)
FALLBACK_TO_NUMBER = os.getenv("TO_NUMBER", "")

# N8N Integration
N8N_WEBHOOK_URL = os.getenv("N8N_WEBHOOK_URL", "")

# SMSFast (virtual phone numbers for WhatsApp registration)
SMSFAST_API_KEY = os.getenv("SMSFAST_API_KEY", "")
SMSFAST_SERVICE = os.getenv("SMSFAST_SERVICE", "wa")

# Shared secret for the OTP/Telnyx webhooks (/otp/webhook, /telnyx/inbound,
# /telnyx/otp) — these have no built-in signature verification (the carrier
# SMS gateway doesn't support HMAC signing, and Telnyx's own Ed25519 scheme
# would need a new crypto dependency plus the account's real public key,
# which isn't available to set up remotely). A shared secret appended to the
# webhook URL as ?secret=... is the practical alternative real integrations
# use when the provider doesn't support real signing. Empty = not configured
# yet: endpoints stay open (today's behavior) but log a warning on every
# call, so this is safe to deploy before the secret is actually set and the
# carrier/Telnyx webhook URLs are updated to include it (security gap found
# 2026-09-30 — these 3 endpoints could inject arbitrary OTP text via ADB into
# a live WhatsApp registration, or read back the real OTP, with zero auth).
OTP_WEBHOOK_SECRET = os.getenv("OTP_WEBHOOK_SECRET", "")

# Evolution API (WhatsApp personal number)
EVOLUTION_API_URL      = os.getenv("EVOLUTION_API_URL", "http://localhost:8080")
EVOLUTION_API_KEY      = os.getenv("EVOLUTION_API_KEY", "")
EVOLUTION_INSTANCE     = os.getenv("EVOLUTION_INSTANCE", "")
APP_PUBLIC_URL         = os.getenv("APP_PUBLIC_URL", "https://app.detucel.com")

# WAHA (WhatsApp HTTP API) — self-hosted provider (being phased out)
WAHA_API_URL           = os.getenv("WAHA_API_URL", "http://localhost:3000")
WAHA_API_KEY           = os.getenv("WAHA_API_KEY", "")

# WasenderAPI — SaaS WhatsApp provider (current)
WASENDER_PAT           = os.getenv("WASENDER_PAT", "")
WASENDER_BASE_URL      = os.getenv("WASENDER_BASE_URL", "https://www.wasenderapi.com")
WWEBJS_URL             = os.getenv("WWEBJS_URL", "http://wwebjs:3001")

# LLM API keys — priority: OPENAI > DEEPSEEK
OPENAI_API_KEY   = os.getenv("OPENAI_API_KEY", "")
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
# Modelo de los clasificadores (Timing + IA y solo IA) — un nivel arriba del de Chat IA
# (gpt-4o-mini, llm.OPENAI_MODEL). Real ask, 2026-10-05. gpt-4.1-mini desde 2026-10-06: ~5 veces más
# barato que gpt-4.1 y en las pruebas falló solo 1 de 65 casos claros (bot contra agente de IA).
CLASSIFIER_MODEL = os.getenv("CLASSIFIER_MODEL", "gpt-4.1-mini")

# Debug: Mostrar qué se cargó (solo para desarrollo)
if __name__ == "__main__":
    print("📋 Configuración cargada:")
    print(f"  MONGODB_URI: {MONGODB_URI}")
    print(f"  DATABASE_NAME: {DATABASE_NAME}")
    print(f"  WHATSAPP_PHONE_NUMBER_ID: {WHATSAPP_PHONE_NUMBER_ID[:10]}..." if WHATSAPP_PHONE_NUMBER_ID else "  WHATSAPP_PHONE_NUMBER_ID: NO CONFIGURADO")
    print(f"  WHATSAPP_ACCESS_TOKEN: {WHATSAPP_ACCESS_TOKEN[:20]}..." if WHATSAPP_ACCESS_TOKEN else "  WHATSAPP_ACCESS_TOKEN: NO CONFIGURADO")
    print(f"  WHATSAPP_TEMPLATE: {WHATSAPP_TEMPLATE}")
    print(f"  WHATSAPP_LANG: {WHATSAPP_LANG}")
    print(f"  FALLBACK_TO_NUMBER: {FALLBACK_TO_NUMBER}")