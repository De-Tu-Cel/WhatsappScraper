# Migración de MongoDB a PostgreSQL

Documento vivo: se marca cada paso al completarlo. Objetivo: pasar toda la base a
PostgreSQL **por etapas, sin pausar la app y pudiendo regresar a Mongo en cualquier
momento** hasta el final.

---

## 1. Qué hay hoy (inventario del código, 2026-10-19)

| Dato | Valor |
|---|---|
| Quién habla con Mongo | **Solo el backend Python** (`apps/api`). La web (Next.js) y wwebjs no se conectan a Mongo. |
| Dónde vive Mongo | Recurso aparte en Coolify (`mongodb-detucel`), no está en `docker-compose.yml`. |
| Colecciones usadas por el código | ~42 (lista abajo) + GridFS para archivos multimedia |
| Llamadas a la base | ~805 en 31 archivos de `apps/api/app` (sin capa de acceso: `db.db.<colección>.<op>` directo) |
| `ObjectId(...)` en el backend | 95 usos; 30 validaciones de "id de 24 caracteres" |
| Frontend | Usa `_id` en muchos componentes (databaseViewer, scheduledSends, InstancesPanel, plantillas…) |
| Transacciones / change streams | **Ninguno** (simplifica mucho) |
| Agregaciones | `$match/$group/$sort/$project/$first/$sum/$addToSet/$cond/$ifNull/$size/$dateToString`. **Sin** `$lookup`, `$facet` ni `$unwind`. Todas traducibles a SQL. |
| Búsquedas de texto | 41 `$regex` (cajas de búsqueda) → `ILIKE` + índice `pg_trgm` |
| Fechas guardadas | Mezcla: 97 `utcnow()`, 76 `now(timezone.utc)`, **109 `datetime.now()` sin zona** |
| Tests | 76 archivos; 45 simulan colecciones de Mongo |

### Colecciones por volumen de uso en el código

| Colección | Llamadas | Notas para la migración |
|---|---|---|
| `message_logs` | 137 | Camino caliente (cada mensaje/webhook). Índice único parcial en `message_id`. Agregaciones de métricas y conversaciones. |
| `instances` | 123 | Estado de cada línea; muchas escrituras desde webhooks. |
| `companies` | 73 | Únicos `domain` y `maps_cid` (con `try/except`: **puede haber duplicados en producción**). |
| `ai_followup_sessions` | 51 | `turns` crece con `$push` → tabla hija. |
| `contacts` | 34 | Único parcial (`source=inbound_whatsapp`). Reclamo atómico en verificación. |
| `jid_map` | 33 | Caché de números verificados; muchos upserts. |
| `scrape_jobs` | 30 | Cola de trabajos; `results` crece con `$push`. |
| `scheduled_sends` | 28 | Campañas programadas; `activity_completed` con `$addToSet`. |
| `conversation_ai_prefs` | 28 | Preferencias por conversación. |
| `users` | 24 | Autenticación (token de sesión). Migrar con mucho cuidado. |
| `send_queue_items` / `_state` / `_batches` / `_requests` | 29 | Cola de envíos con reclamo atómico (`find_one_and_update`). |
| `blacklist`, `proxies`, `settings`, `search_ideas`, `warmup_*`, `message_templates`, `app_notifications`, `contact_permissions`, `instance_health_logs`, `delivery_receipts`, `instance_daily_sends`, `instance_new_contacts_today`, `phone_verification_*`, `ai_*`, `security_counters`, `*_lease`, `stickers`, `social_media`, `person_contacts`, `evidence`, `classification_*` | ≤16 c/u | Mayoría de configuración o bitácoras; buenas candidatas para las primeras etapas. |
| GridFS (`fs.files`/`fs.chunks`) | — | Archivos subidos (`/api/files/...`). |

### Patrones que necesitan traducción especial

- **Reclamos atómicos como cola** (`find_one_and_update`): `send_queue_items`, `ai_reply_pending`, `users`, `instances`, `settings`, `contacts`, `companies`, `message_logs`, `security_counters`, `instance_daily_sends`, `instance_new_contacts_today`. En Postgres → `UPDATE … WHERE … RETURNING` o `SELECT … FOR UPDATE SKIP LOCKED`.
- **Cupos diarios con `$addToSet`/`$pull`** (`daily_cap.py`): → tabla `(instancia, fecha, llave)` con `UNIQUE` + `INSERT … ON CONFLICT DO NOTHING`.
- **Arreglos que crecen sin límite** (`ai_followup_sessions.turns`, `warmup_sessions.messages`, `scrape_jobs.results`): → tablas hijas.
- **Arreglos chicos** (`activity_completed`, `current_urls`, `consent_history`): → `text[]` o `jsonb`.
- **`delivery_receipts`**: su `_id` es la llave de idempotencia de los envíos (un envío nunca se repite). Se migra al final, con la cola de envíos.

---

## 2. Decisiones de diseño (propuestas)

1. **Estrategia "estrangulador" por colección**: Mongo sigue siendo la fuente de verdad hasta que cada tabla esté verificada. Cada colección pasa por: copia → doble escritura → lectura en sombra → cambio de lectura (con interruptor) → retiro de Mongo. Regresar = apagar el interruptor.
2. **Mismos IDs**: cada tabla usa `id text primary key` con el mismo valor hexadecimal de 24 caracteres que el `ObjectId` actual. Los IDs nuevos se siguen generando con `bson.ObjectId()`. Así no cambian URLs, el frontend (`_id`), ni las validaciones de 24 caracteres. Las respuestas de la API siguen exponiendo `_id`.
3. **Esquema híbrido**: columnas reales para lo que se filtra, ordena, une o debe ser único; una columna `doc jsonb` para el resto (análisis de IA, diagnósticos, datos raspados). Con el tiempo se promueven campos de `doc` a columnas.
4. **Fechas**: `timestamptz` en todas las tablas. Al copiar, una fecha sin zona se interpreta como UTC (los contenedores de producción corren en UTC). Ojo: registros creados por un backend local en hora de México pueden quedar 6 h corridos; se documentan, no se "corrigen" a ciegas.
5. **Stack**: `psycopg` 3 (con pool). Sin ORM.
6. **Capa de enrutamiento en vez de reescribir 805 llamadas** (`apps/api/app/pgmirror/`, implementada 2026-10-19). Se mete en el único punto por donde la app obtiene la base (`MongoDBManager.db`) y decide por colección:
   - `mongo` (por defecto, y siempre sin `POSTGRES_URL`): la colección de pymongo tal cual; la capa ni existe.
   - `dual`: todo va a Mongo igual que hoy; después de cada escritura, un hilo vuelve a leer de Mongo los documentos tocados y los deja iguales en `mongo.<colección>` de Postgres. Si Postgres falla, la app no se entera y la colección queda "por conciliar".
   - `shadow`: dual + `find_one`/`count_documents`/`distinct` también consultan Postgres y registran diferencias (en `mongo._shadow_diffs`), respondiendo con Mongo.
   - `postgres`: dual + `find`/`find_one`/`count_documents`/`distinct` se leen de Postgres; lo que el traductor de filtros no soporta se lee de Mongo, nunca se adivina.
   Cada tabla espejo guarda el documento completo en Extended JSON relajado (sin pérdida: `ObjectId`, fechas y texto vs. ObjectId se conservan). Las tablas normalizadas definitivas se construyen después, colección por colección, a partir de estas.
7. **Archivos de GridFS**: tabla `files` con `bytea` si el volumen es chico (lo dirá el diagnóstico); si es grande, almacenamiento tipo S3. GridFS sigue usando Mongo directo mientras tanto.

**Alternativa descartada como destino final: FerretDB** (protocolo de Mongo sobre Postgres). Permitiría cambiar solo la URI, pero los datos quedan como documentos, no como tablas SQL reales, y hay incompatibilidades por confirmar (índices parciales con `$type`). Puede servir como paso temporal si alguna vez se necesita sacar Mongo de golpe.

---

## 3. Plan por etapas

### Etapa 0 — Red de seguridad (antes de tocar datos)
- [x] **Tests nunca tocan la base real**: `apps/api/conftest.py` redirige todo `MongoClient` a una base en memoria (`mongomock`). Antes, `test_scraper`, `test_location` y `test_maps_leads` leían y escribían `companies`/`contacts` de **producción** cada vez que alguien corría pytest con el túnel abierto. Garantizado por `tests/test_no_real_mongo.py`. CI instala `requirements-dev.txt`.
- [x] **Diagnóstico de solo lectura**: `apps/api/scripts/mongo_migration_audit.py` (tamaños, duplicados que romperían `UNIQUE`, llaves con tipos mezclados, forma de los documentos, GridFS).
- [x] **Entorno local de ensayo**: `migration/docker-compose.yml` (Mongo de staging en `127.0.0.1:27030` + Postgres 17 en `127.0.0.1:55432`, solo esta PC).
- [x] **Respaldo verificado en un comando**: `migration/backup_and_stage.ps1` hace `mongodump` (solo lectura), lo restaura en el Mongo de staging, compara colección por colección, guarda un manifiesto con sha256 y corre el diagnóstico sobre la copia. Probado de punta a punta contra una "producción falsa".
- [x] **Capa de migración** `app/pgmirror` + `scripts/pg_mirror.py` (conciliar / carga inicial) + endpoint `GET /api/admin/pgmirror/status`. Probado contra un Postgres real: traductor de filtros con los mismos resultados que Mongo, todos los tipos de escritura reflejados, Postgres caído sin romper escrituras, y un contrato que exige resultados idénticos con y sin capa (`tests/test_pgmirror*.py`, también en CI).
- [ ] **Hacer el primer respaldo real** con el túnel abierto: `.\migration\backup_and_stage.ps1`. Guardar el resumen del diagnóstico (`backups/mongo_audit_<fecha>.txt`).
- [ ] **Ensayo completo con datos reales en local**: carga de todas las colecciones de la copia de staging al Postgres local (ver sección 6).
- [ ] Respaldos automáticos en el servidor (Coolify tiene respaldos programados para bases de datos, o `backup_mongo.py` por cron) y una restauración de prueba.
- [ ] Crear el Postgres de producción en Coolify.

### Etapa 1 — Configuración y catálogos (bajo riesgo)
`settings`, `warmup_config`, `ai_global_config`, `message_templates`, `stickers`, `proxies`, `blacklist`, `app_notifications`, `security_counters`, `social_media`, `person_contacts`, `evidence`.

### Etapa 2 — Bitácoras e históricos (solo se agregan)
`instance_health_logs`, `phone_verification_attempts`, `search_ideas`, `classification_comparisons` y sus logs.

### Etapa 3 — Entidades centrales
`companies` (resolver duplicados de `domain`/`maps_cid` antes), `contacts`, `jid_map`, `contact_permissions`, `instances`, `users` (autenticación: con lectura en sombra más tiempo).

### Etapa 4 — Caminos calientes y colas
`message_logs`, `scheduled_sends`, `send_queue_*`, `scrape_jobs`, `ai_followup_sessions` (+ `turns`), `conversation_ai_prefs`, `ai_reply_pending`, `instance_daily_sends`, `instance_new_contacts_today`, `*_lease`, `warmup_sessions`, `delivery_receipts`.

### Etapa 5 — Archivos y retiro
GridFS → `files`; luego Mongo en solo lectura 30 días con un respaldo final, y se apaga.

---

## 4. Procedimiento por colección (se repite en cada una)

Interruptor: variable `DB_MODE_<COLECCION>` en el servicio backend de Coolify (p. ej. `DB_MODE_MESSAGE_TEMPLATES`). Cambiarla requiere reiniciar el backend, no cambiar código.

1. `DB_MODE_<X>=dual` y reiniciar. Desde ese momento cada escritura se copia sola.
2. **Carga inicial** (lo que ya existía): `python scripts/pg_mirror.py reconcile <x> --fix` dentro del contenedor del backend (terminal de Coolify; ya tiene `MONGODB_URI` y `POSTGRES_URL`).
3. **Conciliar** sin `--fix` dos veces: la segunda debe salir `[OK]`. Revisar `GET /api/admin/pgmirror/status` (`dirty` vacío, `errors` en 0).
4. Unos días en `dual`. Si algo queda "por conciliar", repetir el paso 2.
5. `DB_MODE_<X>=shadow`: lee de las dos, compara y responde con Mongo. Revisar `shadow_diffs` en el estado y la tabla `mongo._shadow_diffs`. Cada diferencia se entiende y se corrige antes de seguir.
6. `DB_MODE_<X>=postgres`: lee de Postgres, sigue escribiendo en las dos. **Regresar = poner `dual` o `mongo` y reiniciar.**
7. Tras días estables en `postgres`: se construye la tabla normalizada definitiva y Postgres pasa a ser la fuente de verdad (esa parte se diseña colección por colección, empezando por las de la etapa 1).

## 5. Cómo evitamos romper algo

- Sin `POSTGRES_URL` el código nuevo no hace nada: desplegarlo no cambia el comportamiento de producción.
- Mongo sigue siendo la fuente de verdad hasta el paso 7; Postgres solo recibe copias.
- Los cambios de lectura van detrás de interruptores, uno por colección, reversibles con un reinicio.
- La doble escritura nunca hace fallar una petición del usuario ni un webhook de WhatsApp.
- Los reclamos atómicos (colas, cupos, idempotencia de envíos) se migran al final y con pruebas de concurrencia, porque un error ahí puede duplicar o perder mensajes.
- Los duplicados que Mongo dejó pasar se resuelven **antes** de crear las restricciones `UNIQUE`, con reglas explícitas por caso (p. ej. fusionar empresas repetidas y sus referencias).
- Ningún test ni script de desarrollo puede escribir en producción (etapa 0).

## 6. Ensayo completo en local (antes de tocar producción)

Con el túnel a producción abierto y Docker Desktop encendido:

```powershell
.\migration\backup_and_stage.ps1          # respaldo verificado + copia local + diagnóstico
cd apps\api
$env:MONGODB_URI  = "mongodb://127.0.0.1:27030/?directConnection=true"   # la COPIA local, no producción
$env:DATABASE_NAME = "commercial"
$env:POSTGRES_URL = "postgresql://app:app_local_only@127.0.0.1:55432/commercial"
python scripts\pg_mirror.py reconcile --all --fix   # carga todo a Postgres local
python scripts\pg_mirror.py reconcile --all         # debe salir [OK] en todas
python scripts\pg_mirror.py status
```

Esto mide tiempos y tamaños reales y destapa cualquier documento que no se pueda copiar, sin riesgo para producción.

## 7. Pendientes de decisión

- [ ] ¿Dónde vive Postgres? (mismo servidor en Coolify vs. administrado: Supabase/Neon/RDS).
- [ ] Reglas para fusionar duplicados (salen del diagnóstico).
- [ ] Destino de los archivos de GridFS (`bytea` vs. S3), según su tamaño real.
