# Lector Comercial

Herramienta de prospección B2B: scraping de sitios web, gestión de conversaciones WhatsApp, seguimiento automático con IA y análisis de respuestas.

![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-Python-009688?logo=fastapi&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-6+-47A248?logo=mongodb&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![WAHA](https://img.shields.io/badge/WAHA-NOWEB-25D366?logo=whatsapp&logoColor=white)
![OpenAI](https://img.shields.io/badge/OpenAI-gpt--4o--mini-412991?logo=openai&logoColor=white)

**Diagrama de funcionamiento:** [Ver en Miro](https://miro.com/app/board/uXjVHW1dNzo=/)

---

## Índice

1. [Funcionalidades](#funcionalidades)
2. [Requisitos previos](#requisitos-previos)
3. [Estructura del proyecto](#estructura-del-proyecto)
4. [Primera vez — bootstrap](#primera-vez--bootstrap)
5. [Instalación](#instalación)
6. [Ejecución](#ejecución)
7. [Variables de entorno](#variables-de-entorno)
8. [Integraciones externas](#integraciones-externas)
9. [Autenticación](#autenticación)
10. [Inteligencia Artificial](#inteligencia-artificial)
11. [Por qué el outbound masivo por WhatsApp no es viable](#por-qué-el-outbound-masivo-por-whatsapp-no-es-viable)
12. [Dependencias principales](#dependencias-principales)
13. [Errores comunes](#errores-comunes)
14. [Runbook operacional](#runbook-operacional)

---

## Funcionalidades

### Prospección — obtener empresas

#### URL Individual (`singleUrlProcessor.jsx` → `pipeline.py` → `scraper.py`)

- Scrapea un sitio: nombre (og:site_name → título → logo alt → h1 → dominio), industria (clasificación por IA + diccionario de palabras clave), descripción, dirección/ciudad/estado/CP, horario, servicios, productos, redes sociales.
- Contactos extraídos: números de WhatsApp (con etiqueta), teléfonos (máx. 20/empresa), emails (máx. 10/empresa), personas de contacto.
- Rastrea hasta 12 subpáginas en paralelo (4 workers), priorizadas por IA; siempre incluye `/contacto`, `/contactanos`, `/contact`.
- Si el HTML estático no trae contactos, cae a Playwright (Chromium headless). Sitios bloqueados por Cloudflare se reintentan con `cloudscraper`.
- Deduplicación por `domain`. Re-scrapeo bloqueado 365 días salvo que la empresa no tenga contactos o se use `force=True`.
- Un paso extra de IA rellena solo los campos vacíos (nunca sobrescribe lo ya encontrado).

#### Lote / Batch URLs (`batchProcessor.jsx`)

- Hasta 50 URLs, concurrencia de 4, pausa/reanudar/cancelar.
- El mensaje se renderiza por fila con los datos de cada empresa; 2+ destinatarios activa rotación de plantillas.
- Exporta resultados a CSV.

#### Importar CSV (`csvImporter.jsx`)

- Acepta `.csv`, `.xlsx`, `.xls` (máx. 5 MB), detecta automáticamente la columna de URLs.
- Mismo límite y concurrencia que Lote. Filas con dominio duplicado se marcan sin reprocesar.

#### Buscar Prospectos (`searchProspects.jsx` → `searcher.py`)

- Búsqueda libre ("plomeros en Guadalajara") — el backend separa industria de ciudad.
- Hasta 4 fuentes en paralelo con Bright Data: SERP, DuckDuckGo, Sección Amarilla, Google Maps. Sin Bright Data: SerpAPI o DuckDuckGo.
- Filtra directorios, redes sociales, franquicias, gobierno, noticias; IA prioriza negocios genuinos.
- Slider 1-200 resultados; historial de búsquedas reciente; marca nuevos / ya en base / bloqueados.

### Gestión de datos

#### Base de Datos (`databaseViewer.jsx`)

- Tabla paginada server-side con filtros y orden por columna.
- Acciones múltiples: enviar campaña, re-scrapear, eliminar.
- Alta manual de empresa; edición inline de campos y números de WhatsApp.

#### Blacklist (`BlacklistPanel.jsx`)

- Listas editables de dominios e industrias bloqueadas.
- Se revisa en `pipeline.py` por dominio antes de scrapear y por industria después de clasificar.

### Envío de mensajes

#### Cola global de envío (`SendQueueContext.jsx` + `SendBubble.jsx`)

- Todos los envíos pasan por una cola global en React context (`addBatch(jobs, label)`).
- `SendBubble` — burbuja flotante con progreso que persiste al navegar entre tabs.
- La cola serializa envíos con delays/pausas configurables y round-robin entre instancias WAHA.
- Cada job: `{ numbers, messages, companyId, website }`.

#### Biblioteca de Plantillas (`messageTemplateLibrary.jsx`)

- CRUD de plantillas reutilizables almacenadas en MongoDB (`/api/admin/message-templates`).
- Variables de interpolación: `{{nombre}}`, `{{industria}}`, `{{ciudad}}`, `{{web}}`.
- `TemplateLibraryPicker` — selector para envíos en bulk; deshabilita plantillas cuyas variables no están disponibles en el conjunto de destinatarios seleccionado.
- Exige un mínimo de variantes (`MIN_TEMPLATES_FOR_BULK`) para envíos a múltiples destinatarios — evitar texto idéntico es una de las señales que usa WhatsApp para detección de spam.

#### Enviar Campañas (`sendCampaign.jsx`)

- Envío masivo inmediato: elegir plantilla(s), destinatarios y ritmo de envío.
- Cada destinatario recibe una variante distinta con sus datos interpolados.
- El progreso se muestra en la burbuja flotante y persiste al navegar.

#### Programar (`scheduledSends.jsx` → `scheduler.py`)

- Igual que Campañas pero para fecha/hora futura.
- El backend revisa cada 60s los envíos vencidos y los despacha.
- Envía recordatorio ~1h antes de que dispare la campaña.
- Hace ping a sesiones WAHA inactivas cada 4h para mantenerlas conectadas.

### Conversaciones e IA

#### Conversaciones (`conversations.jsx`)

- Vista de chat en tiempo real por empresa, una pestaña por número de WhatsApp.
- Responde por la misma instancia WAHA que recibió el último mensaje entrante.
- Contactos inbound desconocidos se registran automáticamente como empresa con `status="inbound"`.

#### Andy — seguimiento automático (`ai_followup.py`)

- Procesa mensajes entrantes uno a la vez con espacio aleatorio de 45-90s entre conversaciones.
- Horario activo: 8:00-21:00 hora Ciudad de México. Ignora mensajes con más de 120 min de antigüedad.
- Simula tiempos humanos: 1-3s de lectura, 3-12s de espera, typing indicator antes de enviar.
- Identifica: humano real, menú/IVR (responde solo la opción), acuse automático (no responde), IA de otra empresa, mensaje en loop (cierra sin gastar llamada).
- Tope de turnos: configurable hasta 20 desde la UI (duro en 10 por defecto).
- Circuit breaker: 3 fallos consecutivos abren el breaker por 5 minutos.

#### Constructor de Andy Bot (`AndyBotBuilder.jsx`)

- Diálogo en Analytics para desplegar un chatbot en un número de WhatsApp vía la API de Andy.
- Se pre-carga con los datos de la empresa seleccionada (nombre, industria, emails, sitio).
- Tipo de bot: `flow` (flujo predefinido) o `ai` (conversacional).
- Requiere `andy_config` configurado en Settings (URL, usuario, contraseña).

#### Análisis / Clasificación (`classifier.py` + `analytics.jsx`)

- Clasifica respuestas en: **Humano**, **Bot**, **Bot IA** (`is_ai=true`), **Automático**, **Híbrido**, **Sin respuesta**.
- Mecanismo T1/T2: si la primera respuesta llega muy rápido sin señales claras de bot, espera una segunda señal.
- Señales deterministas (sin gastar IA): menús numerados, frases de autoidentificación como bot, plantillas de auto-respuesta.
- Umbrales configurables desde Settings → Clasificación.
- Dashboard de Analytics: tabla paginada y ordenable con filtros por categoría, puntaje de calidad, tiempo de reacción, y acciones por fila (generar PDF, abrir Andy Bot Builder).
- SSE en tiempo real para notificar cuando termina el análisis de filas pendientes.
- Generación de PDF: captura del chat con `html2canvas` + reporte enviado al backend.

#### Reportes (`report_generator.py`)

- PDF de una página: captura del chat, categoría, tiempo de primera respuesta (Excelente/Bueno/Regular/Lento), conteo de mensajes.

### Administración del sistema

#### Instancias (`InstancesPanel.jsx`)

- Gestión de números de WhatsApp conectados vía **WAHA** (motor NOWEB).
- Vinculación por QR o por código de emparejamiento.
- Estados en tiempo real: `STARTING` → amarillo, `SCAN_QR_CODE` → amarillo, `WORKING` → verde, `STOPPED`/`FAILED` → rojo.
- Recuperación automática: hasta 3 reintentos antes de escalar a force-reset (timeout 90s).
- Force-reset: elimina y recrea la sesión si los reintentos normales fallan.
- Sync: importa sesiones existentes de WAHA a MongoDB con el botón "Sync WAHA" del panel.

#### Configuración / Settings (`Settings.jsx`)

- **Apariencia:** 38 colores de acento y ~60 temas (dark/light/mono). Se aplican mediante CSS custom properties en tiempo real. También accesible desde el panel de apariencia lateral sin salir de la tab actual.
- **Timing de envío:** delays entre mensajes (5-300s), tamaño de lote (1-20 mensajes), pausa entre lotes (1-30 min). Guardado en localStorage (`send_config`).
- **Clasificación:** umbrales T1/T2, tiempo de espera para "sin respuesta", horas del probe.
- **WhatsApp:** flujo de vinculación de sesión WAHA (crea instancia `{username}-wa`, muestra QR en el panel).
- Tema `detucel` fuerza automáticamente el acento a `#1557f5`.

#### Notificaciones (`NotificationsPanel.jsx`)

- Panel lateral con notificaciones agrupadas por empresa.
- Tipos: `reply` (respuesta de WhatsApp), `batch_complete` (envío masivo terminado), `schedule_reminder` (recordatorio de campaña programada ~1h antes).
- Navegación directa a la conversación o al panel de programados desde la notificación.

#### Administración (`AdminPanel.jsx`)

- Solo visible para rol `admin`.
- Crear usuario (nombre, username, email, PIN), resetear PIN, eliminar, cambiar rol.
- Ver todos los usuarios del sistema con estadísticas agregadas.

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
├── src/
│   ├── app/
│   │   ├── page.jsx                      ← Página principal (sidebar + tabs)
│   │   └── api/                          ← Proxies hacia FastAPI
│   │       ├── instances/                ← CRUD instancias WhatsApp
│   │       ├── waha/                     ← Gestión sesiones WAHA (QR, status, restart)
│   │       ├── admin/instances/          ← Sync WAHA → MongoDB
│   │       ├── process-url/
│   │       ├── companies/
│   │       ├── conversations/
│   │       ├── analytics/
│   │       └── send-message/
│   ├── components/
│   │   ├── singleUrlProcessor.jsx
│   │   ├── batchProcessor.jsx
│   │   ├── csvImporter.jsx
│   │   ├── databaseViewer.jsx
│   │   ├── searchProspects.jsx
│   │   ├── sendCampaign.jsx
│   │   ├── scheduledSends.jsx
│   │   ├── conversations.jsx
│   │   ├── analytics.jsx
│   │   ├── messageTemplateLibrary.jsx    ← Biblioteca y picker de plantillas
│   │   ├── InstancesPanel.jsx            ← Gestión instancias WAHA
│   │   ├── InstanceStatusBanner.jsx      ← Banner de estado de conexión
│   │   ├── SendBubble.jsx                ← Burbuja flotante de progreso
│   │   ├── Settings.jsx                  ← Config global + exports de temas/accents
│   │   ├── AppearancePanel.jsx           ← Panel lateral de apariencia
│   │   ├── NotificationsPanel.jsx        ← Panel lateral de notificaciones
│   │   ├── AndyBotBuilder.jsx            ← Despliegue de chatbot Andy
│   │   ├── AppTour.jsx                   ← Tour de onboarding (react-joyride)
│   │   └── resultDisplay.jsx
│   ├── context/
│   │   ├── SendQueueContext.jsx          ← Cola global de envíos
│   │   ├── UserContext.jsx
│   │   └── LangContext.jsx
│   └── hooks/
│       └── useInstanceStatus.js          ← Polling estado conexión WAHA
├── backEnd/
│   └── app/
│       ├── main.py                       ← Entry point FastAPI
│       ├── pipeline.py                   ← Flujo principal de scraping
│       ├── scraper.py                    ← Extracción de datos del sitio web
│       ├── searcher.py                   ← Búsqueda de prospectos
│       ├── classifier.py                 ← Clasificación de respuestas con IA
│       ├── scheduler.py                  ← Envíos programados + ping WAHA
│       ├── ai_followup.py                ← Seguimiento automático Andy
│       ├── followup_queue.py             ← Cola serial para mensajes entrantes
│       ├── llm.py                        ← Router OpenAI/DeepSeek
│       ├── llm_guard.py                  ← Circuit breaker + retry + semáforo
│       ├── auth.py                       ← Autenticación y sesiones
│       ├── email_service.py              ← Envío de email para reset de PIN
│       ├── otp_manager.py                ← Registro de números vía OTP + ADB
│       ├── config.py                     ← Variables de entorno
│       ├── database.py                   ← Operaciones MongoDB
│       ├── whatsapp_waha.py              ← Cliente WAHA
│       ├── whatsapp_evolution.py         ← Cliente Evolution API (legacy)
│       ├── report_generator.py           ← Generación de PDFs
│       ├── api/routes.py                 ← Endpoints REST
│       ├── schemas/company.py            ← Modelos Pydantic
│       ├── create_user.py                ← Script CLI para crear el primer admin
│       └── .env                          ← Variables de entorno backend
├── Dockerfile.frontend
├── backEnd/Dockerfile.backend
├── docker-compose.yml                    ← Frontend + Backend + WAHA
├── .env.local                            ← Variables de entorno frontend
└── package.json
```

---

## Primera vez — bootstrap

### 1. Crear el primer usuario admin

Antes de poder entrar al sistema hay que crear al menos un usuario admin. Edita `backEnd/app/create_user.py` con el username, nombre y PIN deseados, luego ejecuta:

```bash
cd backEnd/app
python create_user.py
```

El script imprime el **recovery code** — guárdalo en un lugar seguro. Si pierdes el PIN es la única forma de recuperar la cuenta sin acceso a la base de datos.

> Solo dos emails tienen rol admin garantizado por código: `marco@detucel.mx` y `gilad@detucel.mx` (definidos en `auth.py → ALLOWED_DOMAIN` y `ADMIN_EMAILS`). Cualquier otro email se registra con el rol que se le asigne en `create_user.py`.

### 2. Importar sesiones WAHA existentes

Si WAHA ya tiene sesiones creadas (de un setup anterior), hay que importarlas a MongoDB para que aparezcan en el panel de Instancias:

```bash
curl -X POST http://localhost:8000/api/admin/instances/sync-waha \
  -H "x-user-token: TU_SESSION_TOKEN"
```

O desde el panel de Instancias → botón **Sync WAHA**.

Esto crea los documentos en la colección `instances` con `provider: "waha"`. Sin este paso las instancias de WAHA no aparecen en el dashboard.

### 3. Escanear QR

Después del sync, las instancias aparecen en el panel en estado `SCAN_QR_CODE` (amarillo). Hacer clic en el ícono QR de cada una y escanear con el teléfono correspondiente. El estado cambia a `WORKING` (verde) al conectar.

---

## Instalación

### 1. Frontend

```bash
npm install
```

Crea `.env.local` en la raíz:

```env
BACKEND_URL=http://localhost:8000
```

### 2. Backend

```bash
cd backEnd
pip install -r requirements.txt
playwright install chromium --with-deps
```

Crea `backEnd/app/.env` (ver sección [Variables de entorno](#variables-de-entorno) para la lista completa):

```env
MONGODB_URI=mongodb://localhost:27017
DATABASE_NAME=commercial

WAHA_API_URL=http://localhost:3001
WAHA_API_KEY=tu_api_key_de_waha
APP_PUBLIC_URL=https://tu-dominio.com

OPENAI_API_KEY=sk-...
```

### 3. WAHA

```bash
docker-compose up -d waha
```

O manualmente:

```bash
docker run -d \
  --name waha \
  -p 3001:3000 \
  -e WHATSAPP_DEFAULT_ENGINE=NOWEB \
  -e WAHA_API_KEY=tu_api_key \
  -v waha_sessions:/app/.sessions \
  devlikeapro/waha:noweb
```

> **Webhook:** en producción el backend debe ser accesible públicamente. WAHA envía eventos a `{APP_PUBLIC_URL}/api/waha/webhook`. En desarrollo local usa ngrok: `ngrok http 8000` y pon la URL generada en `APP_PUBLIC_URL`.

---

## Ejecución

### Desarrollo

```bash
# 1. WAHA
docker-compose up -d waha

# 2. Backend (desde backEnd/)
cd backEnd
uvicorn app.main:app --reload --port 8000

# 3. Frontend (desde la raíz)
npm run dev
```

| Servicio | URL |
|---|---|
| Frontend / Dashboard | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| Swagger / Docs | http://localhost:8000/docs |
| WAHA | http://localhost:3001 |

### Producción con Docker Compose

```bash
docker-compose up -d
```

El `docker-compose.yml` levanta frontend (`:3000`), backend (`:8000`) y WAHA (`:3001` en el host, `:3000` interno).

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
| `DATABASE_NAME` | Nombre de la base de datos | ✅ (default: `commercial`) |
| `WAHA_API_URL` | URL de WAHA | ✅ |
| `WAHA_API_KEY` | API Key de WAHA | ✅ |
| `APP_PUBLIC_URL` | URL pública del backend (para webhooks) | ✅ en producción |
| `OPENAI_API_KEY` | API Key de OpenAI | Al menos uno de los dos LLM |
| `DEEPSEEK_API_KEY` | API Key de DeepSeek (más económico) | Al menos uno de los dos LLM |
| `SMTP_HOST` | Servidor SMTP para reset de PIN | Opcional (default: `smtp.hostinger.com`) |
| `SMTP_PORT` | Puerto SMTP | Opcional (default: `587`) |
| `SMTP_USER` | Usuario SMTP (email remitente) | Necesario para reset de PIN |
| `SMTP_PASSWORD` | Contraseña SMTP | Necesario para reset de PIN |
| `EVOLUTION_API_URL` | URL de Evolution API (legacy) | Opcional |
| `EVOLUTION_API_KEY` | API Key de Evolution (legacy) | Opcional |
| `SMSFAST_API_KEY` | API Key de SMSFast (números virtuales) | Opcional |

---

## Autenticación

El sistema usa un PIN numérico de 4+ dígitos, no contraseñas de texto. El flujo completo:

- **Login:** `username` + PIN → token de sesión UUID almacenado en MongoDB.
- **Recovery code:** al crear un usuario se genera un código de 12 caracteres. Se muestra una sola vez en consola al ejecutar `create_user.py`. Úsalo si pierdes el PIN.
- **Reset de PIN:** desde la pantalla de login → "Olvidé mi PIN" → ingresa email → llega un token de 8 caracteres por email (expira en 15 min) → ingresa el token + nuevo PIN.
- **Dominio permitido:** solo emails del dominio configurado en `auth.py → ALLOWED_DOMAIN` (actualmente `detucel.mx`) pueden registrarse.
- **Admins garantizados:** los emails en `auth.py → ADMIN_EMAILS` siempre tienen rol `admin` sin importar lo que diga la base de datos.
- Los tokens de sesión no tienen expiración automática — persisten hasta logout o reset de PIN.

---

## Inteligencia Artificial

### Proveedor LLM (`llm.py`)

El sistema usa un único punto de entrada `call_llm()` que enruta automáticamente:

- Si `OPENAI_API_KEY` está configurado → usa `gpt-4o-mini`
- Si no, y `DEEPSEEK_API_KEY` está → usa `deepseek-chat`
- Si ninguno está configurado → la clasificación y Andy quedan inactivos

DeepSeek es significativamente más económico y suficiente para la mayoría de tareas de clasificación. OpenAI da mejores resultados en casos ambiguos.

### Prioridades de cola (`llm_guard.py`)

- `PRIORITY_LIVE` — conversaciones en tiempo real con Andy. Tienen preferencia sobre clasificación en lote.
- `PRIORITY_BATCH` — clasificación en segundo plano. Nunca bloquea una conversación activa.

### Sin IA configurada

Si no hay API key de LLM:
- La clasificación de respuestas no corre (las filas quedan en `pending` indefinidamente).
- Andy no responde mensajes entrantes.
- El scraping y el envío siguen funcionando normalmente.

---

## Integraciones externas

| API | Para qué sirve | Requerida | Dónde se configura |
|---|---|---|---|
| **WAHA** | Sesiones WhatsApp, envío de mensajes, recepción de webhooks, QR | ✅ | `WAHA_API_URL`, `WAHA_API_KEY` en `.env` |
| **OpenAI** | Clasificación de respuestas, seguimiento Andy, enriquecimiento de scraping | Al menos uno | `OPENAI_API_KEY` en `.env` |
| **DeepSeek** | Mismas funciones que OpenAI, más económico | Al menos uno | `DEEPSEEK_API_KEY` en `.env` |
| **Bright Data** | SERP, Google Maps y Sección Amarilla para búsqueda de prospectos | Opcional | Panel de Búsqueda de Prospectos en la UI |
| **SerpAPI** | Búsqueda de prospectos (fallback cuando no hay Bright Data) | Opcional | Panel de Búsqueda de Prospectos en la UI |
| **SMSFast** | Números virtuales para registrar instancias de WhatsApp sin SIM física | Opcional | `SMSFAST_API_KEY` en `.env` |
| **Andy API** | Despliegue de chatbots desde el panel de Analytics | Opcional | Settings → Andy Config (URL, usuario, contraseña) |
| **Evolution API** | Provider WhatsApp legacy — reemplazado por WAHA, aún en el código | Legacy | `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` en `.env` |
| **SMTP (Hostinger)** | Envío de email para reset de PIN | Opcional | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` en `.env` |

### WAHA — endpoints utilizados

Toda la comunicación con WAHA usa el header `X-Api-Key: {WAHA_API_KEY}` y la URL base `WAHA_API_URL`.

#### Gestión de sesiones

| Endpoint | Método | Dónde se usa | Para qué |
|---|---|---|---|
| `/api/sessions` | GET | `pick_connected_instance()` | Listar sesiones y filtrar las en estado `WORKING` para elegir por cuál enviar |
| `/api/sessions` | POST | `_waha_force_reset()` | Recrear una sesión eliminada — la recrea con la misma config (webhook incluido) |
| `/api/sessions/{name}` | GET | auto-restart, force-reset, panel | Verificar el estado actual de una sesión antes de tomar acción |
| `/api/sessions/{name}` | DELETE | `_waha_force_reset()` | Eliminar una sesión atascada en `FAILED`. Usa timeout de 90s — WAHA puede tardar 60+ s en liberar su lock interno |
| `/api/sessions/{name}/restart` | POST | `_waha_auto_restart()` | Reiniciar una sesión caída (hasta 3 intentos antes de escalar a force-reset) |
| `/api/sessions/{name}/start` | POST | `_waha_force_reset()` | Arrancar la sesión después de recrearla — la deja en `SCAN_QR_CODE` esperando nuevo QR |

#### Envío de mensajes

| Endpoint | Método | Dónde se usa | Para qué |
|---|---|---|---|
| `/api/sendText` | POST | `WAHAClient.send_text()` | Enviar mensaje de texto. Payload: `{chatId, text, session}`. Retorna `{id}` del mensaje |
| `/api/startTyping` | POST | `WAHAClient._set_typing()` | Activar indicador "escribiendo..." antes de enviar — simula comportamiento humano |
| `/api/stopTyping` | POST | `WAHAClient._set_typing()` | Desactivar el indicador después de enviar |
| `/api/{session}/presence` | POST | `WAHAClient.set_presence()` | Marcar la sesión como `available` (online) antes de enviar — reduce señales de detección de spam |

El tiempo de escritura se escala por longitud del mensaje (`delay_ms + len(text)`, máx 8 segundos) para que mensajes cortos lleguen rápido y los largos tarden más — un patrón de timing humano.

#### Recepción de mensajes (webhook)

Los eventos llegan al endpoint `POST /api/waha/webhook` del **backend** (no de WAHA). WAHA llama a `{APP_PUBLIC_URL}/api/waha/webhook` con cada evento.

| Evento WAHA | Qué hace el backend |
|---|---|
| `message.any` (inbound) | Guarda en `message_logs`, envía `sendSeen` + mark-as-read, activa clasificación y Andy si aplica |
| `message.any` (outbound) | Actualiza estado del mensaje ya guardado, o lo guarda si es un envío manual no rastreado |
| `message` (cualquier) | Ignorado — WAHA NOWEB dispara tanto `message` como `message.any` por cada mensaje; solo se procesa `message.any` para evitar duplicados |
| `message.ack` | Actualiza el estado de entrega en `message_logs` (`PENDING→pending`, `SERVER→sent`, `DEVICE→delivered`, `READ/PLAYED→read`) |
| `session.status` | Actualiza estado de la instancia en MongoDB; si pasa a `FAILED` dispara auto-restart en background; si pasa a `WORKING` limpia el contador de fallos |

#### Anti-detección de spam (triggered en recepción)

Cuando llega un mensaje inbound, el backend ejecuta en automático:

| Endpoint | Método | Para qué |
|---|---|---|
| `/api/sendSeen` | POST | Envía el "doble check azul" al remitente — simula que se leyó el mensaje |
| `/api/{session}/chats/{chatId}/messages/read` | POST | Marca todos los mensajes del chat como leídos — limpia el badge de no-leídos |
| `/api/{session}/presence` (`available`) | POST | Mantiene la sesión marcada como "online" para que WhatsApp no la detecte como inactiva/bot |

#### Verificación y contactos

| Endpoint | Método | Dónde se usa | Para qué |
|---|---|---|---|
| `/api/contacts/check-exists` | GET | `WAHAClient.check_number()` / `get_jid()` | Verificar que el número tiene WhatsApp antes de enviar — evitar envíos fallidos |
| `/api/{session}/lids/pn/{chatId}` | GET | `WAHAClient.get_jid()` | Obtener el LID (identificador interno) de números de WhatsApp Business — necesario para ruteo correcto de inbound |
| `/api/{session}/contacts/{chatId}` | PUT | `WAHAClient.label_contact()` | Guardar el contacto en la agenda del teléfono antes de enviar — WhatsApp es menos agresivo con contactos guardados |

#### Historial de mensajes

| Endpoint | Método | Dónde se usa | Para qué |
|---|---|---|---|
| `/api/{session}/chats/{chatId}/messages` | GET | `WAHAClient.fetch_messages()` / `fetch_messages_by_jid()` | Sincronizar historial de chat — usado en `/conversations/{id}/sync` para traer mensajes que llegaron mientras el backend estaba caído |

### Bright Data — endpoints utilizados

Bright Data actúa como proxy inteligente: el backend le manda una URL de Google o Google Maps y Bright Data devuelve el HTML/JSON ya parseado desde una IP residencial del país solicitado.

**Endpoint único:** `POST https://api.brightdata.com/request`  
**Auth:** `Authorization: Bearer {BRIGHTDATA_SERP_KEY}`

| Caso de uso | `zone` | `url` enviada | `format` |
|---|---|---|---|
| Google SERP (búsqueda de texto) | `serp_api1` | `https://www.google.com/search?q=...&hl=es&gl=mx` | `json` — devuelve resultados orgánicos ya estructurados |
| Google Maps (negocios con mapa) | `serp_api1` | URL de Maps con coordenadas y query | `raw` — HTML que se parsea manualmente |

El parámetro `country` (ej. `"mx"`) controla desde qué país sale la IP del proxy — no el idioma de resultados.

**Lógica de fan-out:** cuando hay clave de Bright Data, se corren 4 fuentes en paralelo (`ThreadPoolExecutor(max_workers=4)`): Bright Data, DuckDuckGo, Sección Amarilla, Google Maps. Para "cargar más" (offset > 0) solo se pagina Bright Data — las otras tres no soportan paginación real.

> **Nota:** la zona `serp_api1` solo acepta URLs de buscadores (Google, Bing). Intentar pasarle URLs de Sección Amarilla u otros directorios devuelve error `wrong_api` — confirmado en pruebas; por eso Sección Amarilla se scrapea directo con `requests`.

**Cuándo se activa:** si `BRIGHTDATA_SERP_KEY` no está configurada, la búsqueda cae a SerpAPI (si hay key) o DuckDuckGo (siempre disponible).

### SerpAPI y DuckDuckGo — fallbacks de búsqueda

| Fuente | Endpoint | Auth | Cuándo se usa |
|---|---|---|---|
| **SerpAPI** | `GET https://serpapi.com/search` | `api_key` en query params | Sin Bright Data pero con `SERPAPI_KEY` configurada |
| **DuckDuckGo** | Scraping de `https://duckduckgo.com/html/` | Sin key | Siempre disponible, cero costo, menor calidad |

SerpAPI devuelve `organic_results[].link` directamente. DuckDuckGo se scrapea como HTML — extrae los enlaces de resultados con BeautifulSoup.

**Prioridad de fuentes:** Bright Data > SerpAPI > DuckDuckGo (puro).

### Andy API — endpoints utilizados

Andy es un servicio externo de bots para WhatsApp Business. El frontend se conecta directamente a la API de Andy para desplegar chatbots en números de WA Business.

**Base:** `https://dashboard-wa.detucel.com`  
**Auth:** headers `Authorization: Bearer {token}` y `mail: {email}` (configurados en Settings → Andy Config)

| Endpoint | Método | Para qué |
|---|---|---|
| `/api/bot-builder/OwnWA/commercials` | GET | Lista los números de WhatsApp Business disponibles en la cuenta Andy (`phone_number_id`, display name, etc.) |
| `/api/bot-builder/{portfolioId}/build` | POST | Despliega el bot en un número específico. Body: `{company_name, prompt, type, ...}`. Header `phone` = `phone_number_id` elegido |
| `/api/bot-builder/{portfolioId}/pending` | GET | Verifica si hay una configuración de bot pendiente de activación |
| `/api/bot-builder/{portfolioId}/profile-picture` | GET | Obtiene la foto de perfil del número de WA del bot |
| `/api/bot-builder/{portfolioId}/variables` | GET | Lista las variables de personalización disponibles para la plantilla del bot |

El flujo completo: `commercials` → usuario elige número → `build` con los datos de la empresa → el bot queda activo en ese número de WA Business.

---

## Por qué el outbound masivo por WhatsApp no es viable

Esta sección documenta las limitaciones encontradas durante el desarrollo para justificar la decisión de no continuar con el envío masivo de mensajes en frío por WhatsApp.

### El problema de fondo

WhatsApp fue construido como canal de mensajería personal. Meta invierte activamente en detectar y bloquear el uso automatizado no autorizado — no como efecto secundario, sino como política central de la plataforma. Ninguna configuración técnica resuelve esto porque la detección ocurre a nivel de protocolo, no de comportamiento.

### Evidencia concreta

El primer envío masivo real a prospectos externos resultó en ambos números de WhatsApp bloqueados por Meta en **2 minutos y 13 segundos**. Los números tenían meses de historial de uso real. Tenían activas más de 10 técnicas de evasión simultáneas (typing indicator, presencia online, pausas aleatorias, variantes de mensaje, verificación de número, guardar contacto antes de escribir, etc.). Ninguna fue suficiente.

### Restricciones que no tienen solución técnica

- **Meta identifica las herramientas de terceros** — WAHA y Evolution API tienen una huella digital reconocida por los servidores de WhatsApp. La detección ocurre en la conexión, no en el comportamiento.
- **IP compartida entre sesiones** — WAHA gratuito no permite asignar una IP diferente por sesión. Todos los números salen desde la misma dirección, lo que hace trivial para WhatsApp identificar el patrón. Cuando bloquea la IP, caen todos los números simultáneamente.
- **Las políticas de Meta lo prohíben explícitamente** — el uso de APIs no oficiales y el envío masivo no solicitado están prohibidos en los términos de servicio de WhatsApp Business. Es una violación directa, no una zona gris.
- **Incluso la API oficial no permite prospección en frío** — la WhatsApp Business API de Meta solo permite contactar a usuarios que previamente iniciaron conversación o dieron opt-in explícito. No es un canal de outbound.

### Obstáculos encontrados durante el desarrollo

1. WhatsApp no tiene API pública gratuita para envío masivo — cualquier alternativa es no oficial.
2. Evolution API (primer provider) tenía los mismos problemas de detección que WAHA.
3. Registrar números sin teléfono físico requirió montar un emulador Android (Redroid) en EC2, que WhatsApp detecta como entorno virtualizado.
4. Automatizar el registro requirió ingeniería inversa de la app con Frida — proceso frágil que se rompe con cada actualización de WhatsApp.
5. Un número fue bloqueado durante el proceso de registro, antes de enviar un solo mensaje.
6. Reiniciar el módem para cambiar de IP no resolvió el problema — WhatsApp banea el número, no solo la IP.
7. La recuperación automática de sesiones no funciona después de un baneo real — requiere re-escanear QR manualmente.
8. El sistema de force-reset fallaba cuando WAHA estaba procesando múltiples errores simultáneos (timeout de 10s insuficiente — WAHA necesita hasta 90s para liberar el lock interno).

### Costo de hacer funcionar el sistema a escala

Para tener una oportunidad real con 50 números necesitaría: WAHA versión de pago + 50 proxies residenciales individuales + servidor con más RAM. Estimado: **$450–1,200 USD/mes**, sin garantía de que WhatsApp no siga detectando el patrón.

### Alternativas recomendadas

- **Email outreach** — sin límites de volumen, sin riesgo de baneo, mismos datos de empresas del scraper.
- **WhatsApp Business API oficial de Meta** — único canal autorizado para WhatsApp a escala, costo por conversación (~$0.02 USD).
- **LinkedIn outreach** — mejor tasa de respuesta para B2B, herramientas como Phantombuster o Dripify.
- **Usar la plataforma para inbound** — todo lo construido (CRM, conversaciones, IA, métricas) funciona perfectamente para atender prospectos que llegan por otros canales.

---

## Dependencias principales

### Frontend

| Paquete | Para qué sirve |
|---|---|
| `next` ^14 | Framework React / App Router |
| `react` + `react-dom` ^19 | Core de React |
| `@mui/material` ^6 | Componentes UI |
| `@mui/icons-material` ^6 | Iconos Material |
| `@emotion/react` + `@emotion/styled` | CSS-in-JS de MUI |
| `react-joyride` | Tour de onboarding (`AppTour`) |
| `html2canvas` | Captura del chat para PDF |
| `xlsx` | Parseo de archivos Excel en CSV importer |

### Backend

| Paquete | Para qué sirve |
|---|---|
| `fastapi` | Framework API REST |
| `uvicorn[standard]` | Servidor ASGI |
| `pymongo` | Cliente MongoDB |
| `python-dotenv` | Variables de entorno |
| `requests` | HTTP client |
| `beautifulsoup4` | Parseo HTML |
| `playwright` | Scraping de sitios con JS |
| `openai` | Cliente OpenAI y DeepSeek |
| `bcrypt` | Hash de PINs |
| `cloudscraper` | Bypass de Cloudflare en scraping |
| `reportlab` / `fpdf` | Generación de PDFs |

---

## Errores comunes

| Error | Causa | Solución |
|---|---|---|
| `ModuleNotFoundError: config` | uvicorn iniciado desde la raíz | Ejecutar desde `backEnd/` |
| `Error 500` al procesar URL | Backend no activo | Verificar uvicorn en puerto 8000 |
| `Cannot find module '@mui/...'` | Dependencias no instaladas | `npm install` en la raíz |
| Página en blanco | `.env.local` faltante | Crear con `BACKEND_URL=http://localhost:8000` |
| Instancias en gris en el panel | WAHA inaccesible o `provider` no seteado | Verificar `WAHA_API_URL` y hacer Sync WAHA |
| QR no aparece | Sesión WAHA no creada o no sincronizada | Sync WAHA → clic en ícono QR |
| Sesión se desconecta sola | WhatsApp detectó actividad automatizada | Re-escanear QR manualmente |
| `WAHA_API_KEY` inválido | Key incorrecta en `.env` | Verificar key y reiniciar backend |
| Mensajes no llegan | `APP_PUBLIC_URL` incorrecto o backend inaccesible | Verificar URL pública en `.env` |
| Clasificación no corre | Sin API key de LLM configurada | Agregar `OPENAI_API_KEY` o `DEEPSEEK_API_KEY` |
| Email de reset no llega | SMTP sin configurar o credenciales incorrectas | Verificar `SMTP_USER` y `SMTP_PASSWORD` en `.env` |
| `RuntimeError: No LLM` | Ningún provider configurado | Configurar al menos uno de los dos en `.env` |

---

## Runbook operacional

### Sesión WAHA desconectada

1. Abrir el dashboard → **Instancias**
2. Identificar la sesión en rojo o amarillo
3. Clic en el ícono QR → escanear con el teléfono vinculado a ese número
4. El estado cambia a `WORKING` (verde) en ~10 segundos

Si el QR no aparece o la sesión está en `FAILED`: clic en el ícono de reinicio (↺) y esperar 30s. Si sigue fallando, eliminar la sesión y crearla de nuevo.

### Sesión baneada por WhatsApp

El estado muestra `Baneado` (rojo). La sesión no se puede recuperar — ese número de WhatsApp fue bloqueado por Meta. Hay que registrar un número nuevo.

### Agregar un número de WhatsApp nuevo

1. Instancias → **Agregar instancia** → introducir un nombre único
2. Elegir QR o código de emparejamiento
3. Escanear con el teléfono o introducir el número para recibir el código
4. Al conectar, asignar la instancia a un usuario desde el panel de admin

### Reiniciar el backend sin perder sesiones WAHA

Las sesiones de WAHA persisten en el volumen Docker (`waha_sessions`) — son independientes del backend. Reiniciar el backend no desconecta WhatsApp. Solo el reinicio del contenedor de WAHA o borrar el volumen afecta las sesiones.

### Cambiar el PIN de un usuario (admin)

Desde **Administración** → buscar el usuario → **Resetear PIN** → introducir el nuevo PIN.

### El análisis de conversaciones está atascado

Si filas en Analytics llevan mucho tiempo en estado `analyzing`:

```bash
curl -X POST http://localhost:8000/api/admin/requeue-unanalyzed \
  -H "x-user-token: TU_TOKEN"
```

O desde Analytics → el sistema hace auto-requeue cuando detecta filas pendientes.

### Agregar un nuevo usuario

Solo admins. Desde **Administración** → **Nuevo usuario** → completar nombre, username, email y PIN. El sistema muestra el recovery code una sola vez — copiarlo antes de cerrar el modal.

---

## Referencias

Links de documentación oficial para las tecnologías usadas en el proyecto.

### WhatsApp / WAHA

| Recurso | URL |
|---|---|
| Documentación WAHA | https://waha.devlike.pro/ |
| Deploy en Docker | https://waha.devlike.pro/docs/how-to/install/ |
| Motores (NOWEB vs otros) | https://waha.devlike.pro/docs/how-to/engines/ |
| Webhooks — eventos disponibles | https://waha.devlike.pro/docs/how-to/webhooks/ |
| Variables de entorno WAHA | https://waha.devlike.pro/docs/how-to/config/ |
| Swagger interactivo (instancia local) | `http://localhost:3001/` |

### Backend

| Recurso | URL |
|---|---|
| FastAPI | https://fastapi.tiangolo.com/ |
| PyMongo (MongoDB driver) | https://pymongo.readthedocs.io/ |
| Playwright Python (scraping) | https://playwright.dev/python/ |
| python-dotenv | https://github.com/theskumar/python-dotenv |
| BeautifulSoup4 | https://www.crummy.com/software/BeautifulSoup/bs4/doc/ |

### Frontend

| Recurso | URL |
|---|---|
| Next.js 14 (App Router) | https://nextjs.org/docs |
| MUI v6 | https://mui.com/material-ui/ |
| MUI Icons | https://mui.com/material-ui/material-icons/ |
| react-joyride (tour onboarding) | https://react-joyride.com/ |
| html2canvas | https://html2canvas.hertzen.com/ |

### LLM / IA

| Recurso | URL |
|---|---|
| OpenAI API | https://platform.openai.com/docs/ |
| DeepSeek API | https://platform.deepseek.com/api-docs/ |

### Búsqueda de prospectos

| Recurso | URL |
|---|---|
| Bright Data (SERP API) | https://docs.brightdata.com/ |
| SerpAPI | https://serpapi.com/search-api |

### Infraestructura

| Recurso | URL |
|---|---|
| Docker Compose | https://docs.docker.com/compose/ |
| MongoDB (self-hosted) | https://www.mongodb.com/docs/manual/ |
| MongoDB Atlas (cloud) | https://www.mongodb.com/docs/atlas/ |
