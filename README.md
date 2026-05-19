# Lector Comercial

Herramienta de prospección y análisis de empresas. Frontend en Next.js + MUI v9, backend en FastAPI + Python.

---

## Requisitos previos

| Herramienta | Versión mínima | Verificar con |
|---|---|---|
| Node.js | 18+ | `node -v` |
| npm | 9+ | `npm -v` |
| Python | 3.10+ | `python --version` |
| MongoDB | 6+ (local o Atlas) | — |

---

## Estructura

```
NextJsProject/
├── src/                    ← Frontend Next.js
│   ├── app/
│   │   ├── layout.jsx
│   │   ├── page.jsx
│   │   └── api/            ← Proxies → FastAPI
│   │       ├── process-url/route.js
│   │       ├── search/route.js
│   │       └── batch/route.js
│   ├── components/
│   └── theme/
├── backEnd/
│   └── app/                ← Backend FastAPI
│       ├── main.py
│       ├── pipeline.py
│       ├── scraper.py
│       ├── searcher.py
│       ├── config.py
│       ├── database.py
│       ├── whatsapp_client.py
│       └── api/routes.py
├── .env.local              ← Variables de entorno frontend
└── package.json
```

---

## Instalación

### 1. Frontend

```bash
# En la raíz del proyecto
npm install
```

Crea el archivo `.env.local` en la raíz:

```
BACKEND_URL=http://localhost:8000
```

### 2. Backend

```bash
cd backEnd
python -m pip install -r requirements.txt
```

Verifica que `backEnd/app/.env` exista con las variables necesarias (MongoDB URI, tokens de WhatsApp, etc.).

---

## Ejecución

Iniciar en este orden:

```bash
# 1. Backend (desde backEnd/)
cd backEnd
uvicorn app.main:app --reload --port 8000

# 2. Frontend (desde la raíz, en otra terminal)
npm run dev
```

| Servicio | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend / Swagger | http://localhost:8000/docs |

---

## Dependencias Frontend

| Paquete | Versión | Para qué sirve |
|---|---|---|
| `next` | ^16 | Framework React / App Router |
| `react` + `react-dom` | ^19 | Core de React |
| `@mui/material` | ^9 | Componentes UI |
| `@mui/icons-material` | ^9 | Iconos Material |
| `@emotion/react` + `@emotion/styled` + `@emotion/cache` | ^11 | CSS-in-JS de MUI |
| `@fontsource/roboto` | ^5 | Fuente Roboto local |

## Dependencias Backend

| Paquete | Para qué sirve |
|---|---|
| `fastapi` | Framework API REST |
| `uvicorn[standard]` | Servidor ASGI |
| `pymongo` | Cliente MongoDB |
| `python-dotenv` | Variables de entorno |
| `requests` | HTTP para scraping |
| `beautifulsoup4` | Parseo HTML |
| `googlesearch-python` | Búsqueda de prospectos |

---

## Errores comunes

| Error | Causa | Solución |
|---|---|---|
| `ModuleNotFoundError: config` | uvicorn iniciado desde la raíz | Ejecutar desde `backEnd/` |
| `Error 500` al procesar URL | Backend no activo | Verificar uvicorn en puerto 8000 |
| `Cannot find module '@mui/...'` | Dependencias no instaladas | `npm install` en la raíz |
| Página en blanco | `.env.local` faltante | Crear con `BACKEND_URL=http://localhost:8000` |
