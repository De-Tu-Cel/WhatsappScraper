# Lector Comercial

Herramienta de prospección B2B: scraping de sitios web, envío de mensajes WhatsApp, gestión de conversaciones y análisis de respuestas con IA.

**Stack:** Next.js 14 + MUI v6 · FastAPI + Python · MongoDB · Evolution API · Groq (Llama 3.1)

---

## Funcionalidades

| Módulo | Descripción |
|---|---|
| **URL Individual** | Scrapea un sitio web y extrae datos de la empresa (nombre, industria, WhatsApp, redes sociales, etc.) |
| **Lote (URLs)** | Procesa múltiples URLs en paralelo y envía mensajes con plantillas personalizadas |
| **Importar CSV** | Importa empresas desde un archivo CSV |
| **Base de datos** | Visualiza, filtra, edita y elimina empresas scrapeadas |
| **Buscar Prospectos** | Busca empresas por industria/ciudad usando Google Search |
| **Conversaciones** | Chat en tiempo real con empresas vía WhatsApp (Evolution API) |
| **Análisis** | Clasifica respuestas recibidas con IA: Humano / Bot / Bot IA / Automático |

---

## Requisitos previos

| Herramienta | Versión mínima | Verificar con |
|---|---|---|
| Node.js | 18+ | `node -v` |
| npm | 9+ | `npm -v` |
| Python | 3.10+ | `python --version` |
| MongoDB | 6+ (local o Atlas) | — |
| Docker + Docker Compose | 24+ | `docker -v` |

---

## Estructura del proyecto

```
WhatsappScraper/
├── src/                          ← Frontend Next.js
│   ├── app/
│   │   ├── page.jsx              ← Página principal (sidebar + tabs)
│   │   └── api/                  ← Proxies hacia FastAPI
│   │       ├── process-url/
│   │       ├── companies/
│   │       ├── conversations/
│   │       ├── analytics/
│   │       └── send-message/
│   └── components/
│       ├── singleUrlProcessor.jsx
│       ├── batchProcessor.jsx
│       ├── csvImporter.jsx
│       ├── databaseViewer.jsx
│       ├── searchProspects.jsx
│       ├── conversations.jsx
│       ├── analytics.jsx
│       └── resultDisplay.jsx
├── backEnd/
│   └── app/
│       ├── main.py               ← Entry point FastAPI
│       ├── pipeline.py           ← Flujo principal de scraping + envío
│       ├── scraper.py            ← Extracción de datos del sitio web
│       ├── searcher.py           ← Búsqueda de prospectos (Google)
│       ├── classifier.py         ← Clasificación de respuestas con Groq
│       ├── config.py             ← Variables de entorno
│       ├── database.py           ← Operaciones MongoDB
│       ├── whatsapp_evolution.py ← Cliente Evolution API
│       ├── api/routes.py         ← Endpoints REST
│       ├── schemas/company.py    ← Modelos Pydantic
│       └── .env                  ← Variables de entorno backend
├── evolution/                    ← Docker Compose de Evolution API
│   └── docker-compose.yml
├── .env.local                    ← Variables de entorno frontend
└── package.json
```

---

## Instalación

### 1. Frontend

```bash
# En la raíz del proyecto
npm install
```

Crea `.env.local` en la raíz:

```env
BACKEND_URL=http://localhost:8000
```

---

### 2. Backend

```bash
cd backEnd
pip install -r requirements.txt
```

Crea `backEnd/app/.env` con las siguientes variables:

```env
# MongoDB
MONGODB_URI=mongodb://localhost:27017
DATABASE_NAME=commercial

# Evolution API (WhatsApp)
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=tu_api_key_de_evolution
EVOLUTION_INSTANCE=nombre_de_tu_instancia

# Groq (clasificación de respuestas con IA) — gratis en console.groq.com
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx

# WhatsApp Business API (Meta) — opcional
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
```

---

### 3. Evolution API (WhatsApp)

Evolution API corre en Docker y es la que conecta tu número de WhatsApp personal para enviar y recibir mensajes.

```bash
cd evolution
docker-compose up -d
```

Después de levantar el contenedor:

1. Abre `http://localhost:8080` (o el puerto configurado)
2. Crea una instancia nueva
3. Escanea el QR con WhatsApp en tu teléfono
4. Copia el **API Key** y el **nombre de instancia** al `.env` del backend
5. Configura el webhook apuntando a `http://localhost:8000/api/evolution/webhook`

> **Nota para producción:** Evolution API necesita ser accesible públicamente para recibir mensajes entrantes. Usa [ngrok](https://ngrok.com) en desarrollo: `ngrok http 8000` y actualiza la URL del webhook en Evolution.

---

## Ejecución

Inicia los servicios en este orden:

```bash
# 1. Evolution API (Docker)
cd evolution
docker-compose up -d

# 2. Backend FastAPI (nueva terminal, desde backEnd/)
cd backEnd
uvicorn app.main:app --reload --port 8000

# 3. Frontend Next.js (nueva terminal, desde la raíz)
npm run dev
```

| Servicio | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| Swagger / Docs | http://localhost:8000/docs |
| Evolution API | http://localhost:8080 |

---

## Configurar Groq (clasificación IA) — gratis

1. Crea cuenta en [console.groq.com](https://console.groq.com) (sin tarjeta de crédito)
2. Ve a **API Keys** → **Create API Key**
3. Copia la key (`gsk_...`) al campo `GROQ_API_KEY` en `backEnd/app/.env`
4. Reinicia el backend

A partir de ese momento cada respuesta inbound de WhatsApp se clasifica automáticamente como:
- 👤 **Humano** — persona real, lenguaje informal, faltas de ortografía
- ⚡ **Automático** — mensaje de fuera de horario o confirmación genérica
- 🤖 **Bot** — flujo predefinido con menús
- 🧠 **Bot IA** — chatbot conversacional con inteligencia artificial

---

## Variables de entorno

### Frontend — `.env.local`

| Variable | Descripción | Ejemplo |
|---|---|---|
| `BACKEND_URL` | URL del backend FastAPI | `http://localhost:8000` |

### Backend — `backEnd/app/.env`

| Variable | Descripción | Requerida |
|---|---|---|
| `MONGODB_URI` | URI de conexión MongoDB | ✅ |
| `DATABASE_NAME` | Nombre de la base de datos | ✅ |
| `EVOLUTION_API_URL` | URL de Evolution API | ✅ |
| `EVOLUTION_API_KEY` | API Key de Evolution | ✅ |
| `EVOLUTION_INSTANCE` | Nombre de instancia Evolution | ✅ |
| `GROQ_API_KEY` | API Key de Groq (clasificación IA) | Opcional |
| `WHATSAPP_PHONE_NUMBER_ID` | ID de número Meta Business API | Opcional |
| `WHATSAPP_ACCESS_TOKEN` | Token Meta Business API | Opcional |

---

## Dependencias

### Frontend

| Paquete | Para qué sirve |
|---|---|
| `next` ^14 | Framework React / App Router |
| `react` + `react-dom` ^19 | Core de React |
| `@mui/material` ^6 | Componentes UI |
| `@mui/icons-material` ^6 | Iconos Material |
| `@emotion/react` + `@emotion/styled` | CSS-in-JS de MUI |

### Backend

| Paquete | Para qué sirve |
|---|---|
| `fastapi` | Framework API REST |
| `uvicorn[standard]` | Servidor ASGI |
| `pymongo` | Cliente MongoDB |
| `python-dotenv` | Variables de entorno |
| `requests` | HTTP para scraping |
| `beautifulsoup4` | Parseo HTML |
| `googlesearch-python` | Búsqueda de prospectos |
| `ddgs` | Búsqueda DuckDuckGo |
| `groq` | Cliente Groq API (clasificación IA) |

---

## Errores comunes

| Error | Causa | Solución |
|---|---|---|
| `ModuleNotFoundError: config` | uvicorn iniciado desde la raíz | Ejecutar desde `backEnd/` |
| `Error 500` al procesar URL | Backend no activo | Verificar uvicorn en puerto 8000 |
| `Cannot find module '@mui/...'` | Dependencias no instaladas | `npm install` en la raíz |
| Página en blanco | `.env.local` faltante | Crear con `BACKEND_URL=http://localhost:8000` |
| `Groq no configurado` en Análisis | `GROQ_API_KEY` vacío o `.env` no cargado | Verificar key en `backEnd/app/.env` y reiniciar backend |
| QR de WhatsApp no aparece | Evolution API no levantado | `docker-compose up -d` en carpeta `evolution/` |
| Mensajes no llegan al webhook | URL del webhook incorrecta | Verificar que apunta a `http://localhost:8000/api/evolution/webhook` |
