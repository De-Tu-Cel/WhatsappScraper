# config.py
import os
from pathlib import Path
from dotenv import load_dotenv

# Cargar variables de entorno — busca .env junto a este archivo primero, luego sube
load_dotenv(dotenv_path=Path(__file__).parent / '.env')

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

# Evolution API (WhatsApp personal number)
EVOLUTION_API_URL      = os.getenv("EVOLUTION_API_URL", "http://localhost:8080")
EVOLUTION_API_KEY      = os.getenv("EVOLUTION_API_KEY", "")
EVOLUTION_INSTANCE     = os.getenv("EVOLUTION_INSTANCE", "")
APP_PUBLIC_URL         = os.getenv("APP_PUBLIC_URL", "https://app.detucel.com")

# DeepSeek API (IA: clasificación, sugerencias, scraping, Andy)
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")

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