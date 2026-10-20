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
| Tamaño real (respaldo del 2026-10-19) | 43 colecciones, 91 316 documentos, respaldo comprimido de 4.7 MB. La más grande: `contacts` (75 927 docs, 18.8 MB); luego `message_logs` (6 538 docs, 8.2 MB). GridFS: 5 archivos, 0.01 MB. |
| Duplicados que romperían `UNIQUE` | **Ninguno** en `companies.domain/maps_cid`, `message_logs.message_id`, `search_ideas.url`, `contacts.value`, `instances.name`, `users.username/email/session_token`. |
| Llaves con tipos mezclados | `contacts.company_id`: 47 402 `ObjectId` y 28 525 texto. `instance_daily_verifications._id`: 41 `ObjectId` y 3 texto. La capa los conserva tal cual; se normalizan al crear las tablas definitivas. |

### Colecciones por volumen de uso en el código

| Colección | Llamadas | Notas para la migración |
|---|---|---|
| `message_logs` | 137 | Camino caliente (cada mensaje/webhook). Índice único parcial en `message_id`. Agregaciones de métricas y conversaciones. |
| `instances` | 123 | Estado de cada línea; muchas escrituras desde webhooks. |
| `companies` | 73 | Únicos `domain` y `maps_cid` (creados con `try/except`; el diagnóstico del 2026-10-19 no encontró duplicados, se vuelve a revisar antes de crear `UNIQUE`). |
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
   - `shadow`: dual + `find`/`find_one`/`count_documents`/`distinct` se comparan contra Postgres **en un hilo aparte** (la petición no espera) y las diferencias quedan en `mongo._shadow_diffs` y en el estado. Siempre responde Mongo.
   - `postgres`: dual + `find`/`find_one`/`count_documents`/`distinct` se leen de Postgres. Lo que el traductor no soporta, o cualquier error de Postgres (también a mitad de un cursor), se resuelve en Mongo: nunca se adivina ni se le muestra un error a la app. Para no leer datos viejos: la copia de cada escritura se hace **en línea, antes de responder** (lo escrito se lee enseguida desde cualquier proceso); si esa copia falla, la colección queda marcada "por conciliar" en `mongo._dirty` y **todos** los procesos leen de Mongo hasta que una conciliación posterior la limpie (~1 min).
   - Toda copia (en línea, hilo de fondo o conciliación) toma un candado por documento en Postgres antes de leer de Mongo (`Store.replace_from_source`): dos procesos copiando el mismo documento se turnan y nunca queda una versión vieja encima de una nueva.
   Cada tabla espejo (`mongo.<colección>`) guarda el documento en Extended JSON relajado: `doc jsonb` para filtrar y `src` con el texto exacto, porque jsonb reordena las llaves y Mongo/la app conservan ese orden (p. ej. un horario lunes…domingo). `seq` guarda el orden de inserción, el equivalente del orden natural de Mongo. Así no se pierde nada: `ObjectId`, fechas, texto vs. `ObjectId` y el orden de las llaves vuelven iguales. Las tablas normalizadas definitivas se construyen después, colección por colección, a partir de estas.

   **Semántica medida contra Mongo 7 real**, no supuesta. El traductor reproduce cómo recorre Mongo las rutas `a.b.c` a través de arreglos de objetos, `null` y campos faltantes, arreglos vacíos, comparaciones por tipo, orden (el arreglo ordena por su menor/mayor elemento, el vacío va antes que `null`) y proyecciones dentro de arreglos. `tests/test_pgmirror_vs_mongo.py` lo compara en cada corrida de CI contra un Mongo 7 de verdad (cientos de filtros, órdenes, proyecciones y `distinct` sobre documentos con formas difíciles).

   **Lo que se deja a Mongo a propósito** (sale como `Unsupported` y se lee de Mongo): `$elemMatch`, `$size`, `$all`, `$not`, `$type`, `$expr`, rutas con índice (`a.0`), igualdad contra un subdocumento (Mongo compara el orden de sus llaves), regex con sintaxis que significa otra cosa en Postgres (`\b`, `\w`, `(?…)`, `[^…]`, clases POSIX, cuantificadores posesivos), agregaciones y opciones de cursor poco comunes. **Única diferencia conocida**: ordenar por un campo cuyo valor es un subdocumento no sigue el orden de objetos de BSON; la app no lo hace y el modo shadow lo detectaría.
7. **Archivos de GridFS**: tabla `files` con `bytea` si el volumen es chico (lo dirá el diagnóstico); si es grande, almacenamiento tipo S3. GridFS sigue usando Mongo directo mientras tanto.

**Alternativa descartada como destino final: FerretDB** (protocolo de Mongo sobre Postgres). Permitiría cambiar solo la URI, pero los datos quedan como documentos, no como tablas SQL reales, y hay incompatibilidades por confirmar (índices parciales con `$type`). Puede servir como paso temporal si alguna vez se necesita sacar Mongo de golpe.

---

## 3. Plan por etapas

### Etapa 0 — Red de seguridad (antes de tocar datos)
- [x] **Tests nunca tocan la base real**: `apps/api/conftest.py` redirige todo `MongoClient` a una base en memoria (`mongomock`). Antes, `test_scraper`, `test_location` y `test_maps_leads` leían y escribían `companies`/`contacts` de **producción** cada vez que alguien corría pytest con el túnel abierto. Garantizado por `tests/test_no_real_mongo.py`. CI instala `requirements-dev.txt`.
- [x] **Diagnóstico de solo lectura**: `apps/api/scripts/mongo_migration_audit.py` (tamaños, duplicados que romperían `UNIQUE`, llaves con tipos mezclados, forma de los documentos, GridFS).
- [x] **Entorno local de ensayo**: `migration/docker-compose.yml` (Mongo de staging con la copia real en `127.0.0.1:27030`, Postgres 17 en `127.0.0.1:55432` y un Mongo 7 vacío para pruebas en `127.0.0.1:27029`; solo esta PC).
- [x] **Respaldo verificado en un comando**: `migration/backup_and_stage.ps1` hace `mongodump` (solo lectura), lo restaura en el Mongo de staging, compara colección por colección, guarda un manifiesto con sha256 y corre el diagnóstico sobre la copia. Probado de punta a punta contra una "producción falsa".
- [x] **Capa de migración** `app/pgmirror` + `scripts/pg_mirror.py` (conciliar / carga inicial) + endpoint `GET /api/admin/pgmirror/status`. Probado contra un Postgres real: traductor de filtros con los mismos resultados que Mongo, todos los tipos de escritura reflejados, Postgres caído sin romper escrituras, y un contrato que exige resultados idénticos con y sin capa (`tests/test_pgmirror*.py`, también en CI).
- [x] **Primer respaldo real** (2026-10-19): `backups/backup_20261019_183610.archive.gz` — 43 colecciones y 91 316 documentos, restaurado y verificado colección por colección, con manifiesto sha256. Diagnóstico en `backups/mongo_audit_20261019_183610.json`. `backups/` no se sube a git (datos reales).
- [x] **Semántica contra Mongo 7 real**: el ensayo destapó diferencias que mongomock nunca habría mostrado (rutas que cruzan arreglos de objetos, `null`, orden con arreglos, orden de llaves de jsonb, `ObjectId` dentro de arreglos, `int64`). Corregidas; CI ahora corre un Mongo 7 desechable y falla si no puede comparar contra él (`REQUIRE_REAL_ENGINES`).
- [x] **Ensayo completo con datos reales en local** (2026-10-19, ver sección 6): las 43 colecciones se cargan en ~13 s y la segunda conciliación sale `[OK]` en todas. Verificación estricta contra la copia real:
  - Ida y vuelta: **91 316 de 91 316** documentos idénticos (tipos y orden de llaves).
  - Filtros con valores reales: **9 833** consultas, **0** diferencias.
  - Orden (`sort` + `skip`/`limit`): **976** consultas, **0** diferencias.
  - `distinct`: 482 de 485 iguales; las 3 restantes son una rareza de Mongo (con índice devuelve `null` por documentos *sin* el campo, sin índice no). La capa ya no adivina: si algún documento no tiene el campo, ese `distinct` lo resuelve Mongo. `send_now_worker` dependía de ese `null` para arrancar la partición "legacy" (items sin `user_id`); ahora lo revisa explícitamente (`tests/test_send_partitions_legacy.py`).
  - Rendimiento: el JIT de Postgres tardaba ~12 s en compilar las expresiones de orden (la consulta tarda <1 s). Las conexiones de la capa lo apagan (`jit=off`).
- [ ] Respaldos automáticos en el servidor (Coolify tiene respaldos programados para bases de datos, o `backup_mongo.py` por cron) y una restauración de prueba.
- [x] Postgres de producción en Coolify (2026-10-20): PostgreSQL 17.11, destino `coolify` (misma red que el backend y `mongodb-detucel`), privado, base `postgres`. `POSTGRES_URL` y `DB_MODES` en el backend.

### Etapa 1 — Configuración y catálogos (bajo riesgo)
`settings`, `warmup_config`, `ai_global_config`, `message_templates`, `stickers`, `proxies`, `blacklist`, `app_notifications`, `security_counters`, `social_media`, `person_contacts`, `evidence`.

| Colección | dual | shadow | postgres |
|---|---|---|---|
| `settings` | 2026-10-20 (2 docs, carga + conciliación `[OK]`) | | |
| `message_templates` | 2026-10-20 (72 docs, `[OK]`) | | |
| `blacklist` | 2026-10-20 (361 docs, `[OK]`) | | |
| `warmup_config`, `ai_global_config` | 2026-10-20 (1 doc c/u, carga automática `OK`) | | |
| `proxies` | 2026-10-20 (20 docs, carga automática `OK`) | | |
| `app_notifications` | 2026-10-20 (92 docs, carga automática `OK`) | | |
| `security_counters` | 2026-10-20 (vacía; se copia al primer uso) | | |
| `social_media` | 2026-10-20 (1 724 docs, carga automática `OK`) | | |
| `person_contacts` | 2026-10-20 (370 docs, carga automática `OK`) | | |

`stickers` y `evidence` no existen hoy en Mongo; se agregan cuando aparezcan. Primer `check` en producción (2026-10-20): las 10 en `OK`, 0 correcciones, dos procesos del backend reportando, 0 errores.

Revisión (terminal del contenedor backend): `python scripts/pg_mirror.py check` → dice si cada una ya puede avanzar.

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

Interruptor: variable `DB_MODES` del backend en Coolify, con el modo de cada colección separado por comas (p. ej. `settings=dual,message_templates=dual,blacklist=dual`). Es la única que hay que tocar: `docker-compose.yml` ya la pasa al contenedor junto con `POSTGRES_URL` (el backend solo recibe las variables que ese archivo lista). Una colección que no aparece, o un modo mal escrito, se queda en Mongo. Cambiarla requiere redesplegar el backend, no cambiar código. (`DB_MODE_<COLECCION>` también funciona y gana sobre `DB_MODES`, útil en local.)

**Vigilancia automática** (`app/pgmirror/health.py`, desde 2026-10-20): cada proceso del backend guarda cada minuto sus estadísticas en Postgres y concilia solo cada colección activa cada 3 h (`PGMIRROR_RECONCILE_HOURS`), o antes si quedó "por conciliar". Medido sobre la copia real: la carga inicial de `contacts` (75 927 docs) + `companies` tarda ~18 s y la conciliación de rutina de 27 colecciones ~2 s. Lo que corrige lo manda a copiar por el mismo SyncWorker (relee de Mongo, nunca pisa algo más nuevo) y lo anota en `mongo._reconcile_log`. Una sola instrucción lo resume todo, en la terminal del contenedor backend:

```sh
python scripts/pg_mirror.py check
```

Por cada colección activa: modo, días en ese modo, conteos Mongo/Postgres, si están iguales ahora, documentos corregidos y comparaciones de shadow de los últimos 3 días, y el veredicto (`esperar N días`, `LISTA para shadow`, `LISTA para postgres` o qué revisar).

1. Agregar `<x>=dual` a `DB_MODES` y redesplegar. Desde ese momento cada escritura se copia sola, y al minuto el backend hace la **carga inicial** de lo que ya existía (queda como `initial`, no cuenta como corrección). Ya no hace falta correr `reconcile --fix` a mano (sigue disponible).
2. Revisar con `check` que la colección salga `OK`.
3. (sin paso manual: la conciliación es automática)
4. 24 h en `dual` sin correcciones (`PGMIRROR_WAIT_HOURS`, se acortó de 3 días el 2026-10-20 para acelerar) → `check` dice `LISTA para shadow`. Si hubo correcciones, el espejo en vivo se saltó algo: se investiga antes de avanzar. `shadow` no cambia lo que ve la app (siempre responde Mongo), así que también se puede encender sin esperar.
5. `<x>=shadow` en `DB_MODES`: lee de las dos, compara y responde con Mongo. Revisar `shadow_diffs` en el estado y la tabla `mongo._shadow_diffs`. Cada diferencia se entiende y se corrige antes de seguir.
6. `<x>=postgres` en `DB_MODES`: lee de Postgres, sigue escribiendo en las dos. **Regresar = poner `dual` o quitarla de `DB_MODES` y redesplegar.**
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

Para correr las pruebas de la capa contra los motores reales (lo mismo que hace CI):

```powershell
docker compose -f migration/docker-compose.yml up -d     # incluye mongo-test (27029, vacío y desechable)
cd apps\api
python -m pytest tests/test_pgmirror.py tests/test_pgmirror_vs_mongo.py tests/test_pgmirror_contract.py -q
```

## 7. Pendientes de decisión

- [ ] ¿Dónde vive Postgres? (mismo servidor en Coolify vs. administrado: Supabase/Neon/RDS). Con ~30 MB de datos, un PostgreSQL 17 en el mismo Coolify sobra; lo importante es activarle respaldos programados.
- [x] Reglas para fusionar duplicados: hoy no hay duplicados (diagnóstico del 2026-10-19). Se vuelve a correr el diagnóstico justo antes de crear cada `UNIQUE`.
- [x] Destino de los archivos de GridFS: son 5 archivos (0.01 MB) → tabla con `bytea`, sin S3.
