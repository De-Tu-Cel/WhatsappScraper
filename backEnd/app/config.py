# config.py
import os
from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv()

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

# Validación de variables críticas
if not WHATSAPP_PHONE_NUMBER_ID:
    print("⚠️ WARNING: WHATSAPP_PHONE_NUMBER_ID no está configurado en .env")

if not WHATSAPP_ACCESS_TOKEN:
    print("⚠️ WARNING: WHATSAPP_ACCESS_TOKEN no está configurado en .env")

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