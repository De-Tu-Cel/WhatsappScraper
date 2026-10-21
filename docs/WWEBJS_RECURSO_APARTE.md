# WhatsApp (wwebjs) como recurso aparte en Coolify

**Por qué:** `wwebjs` vive en el mismo `docker-compose.yml` que el backend y el frontend, así que
**cada despliegue** (un merge a `main`, un cambio de variable) reinicia también todas las sesiones de
WhatsApp. El 2026-10-20 la de gely tardó en volver tras el despliegue de las 21:05 UTC. Separado en su
propio recurso, desplegar el backend ya no toca WhatsApp; `wwebjs` solo se reinicia cuando se
despliega a mano.

**Estado: hecho el 2026-10-21 00:34 UTC (18:34 del 20 en México).** Recurso `wwebjs` en Coolify:
`vjpqgxgak97x5ry8ql7xmvwb`, rama `main`, Auto Deploy apagado, volumen alias
`vjpqgxgak97x5ry8ql7xmvwb_wwebjs-sessions`. El backend lo usa por `http://detucel-wwebjs:3001` y
el despliegue siguiente del backend (00:41 UTC) ya no reinició WhatsApp (misma hora de arranque).
Interrupción del corte: ~1 min; gely-wa, sender666 y tania-sesion-1 volvieron solas.

**Lo que no cambia: las sesiones.** Ningún número se vuelve a vincular. Los perfiles se quedan donde
están, en el volumen de siempre:

- Volumen: `dpwlknbsbuvups4fy4kahcyk_wwebjs-sessions` (6 perfiles `session-*` al 2026-10-20)
- Carpeta en el servidor: `/var/lib/docker/volumes/dpwlknbsbuvups4fy4kahcyk_wwebjs-sessions/_data`

**Cómo, y por qué así** (revisado en el código de Coolify 4.3.18 del servidor):

- Coolify renombra **todo** volumen con nombre a `<uuid del recurso>_<nombre>`, también los marcados
  `external` (solo respeta cifs/nfs). Un recurso nuevo montaría uno vacío.
- Montar la carpeta por ruta absoluta funciona, pero Coolify la registra como "archivo" del recurso y,
  si alguien la borra en su panel, hace `rm -rf` de la carpeta: todas las sesiones.
- Por eso el recurso nuevo usa su volumen normal (`<uuid nuevo>_wwebjs-sessions`), pero **creado antes
  a mano como alias** de la carpeta de siempre. Probado: mismos archivos, el candado de
  `storage-entrypoint.sh` se comparte (si un wwebjs lo tiene, el otro no arranca, así nunca hay dos
  conectando los mismos números) y borrar el alias no borra nada.
- Si el alias se olvida, Docker crea un volumen vacío y el servicio **no arranca**
  (`REQUIRE_EXISTING_SESSIONS=1`): nadie termina vinculando números en el lugar equivocado.
- El recurso principal deja un contenedor mínimo, `wwebjs-sessions-anchor`, que monta el volumen
  original en solo lectura: Docker lo ve "en uso" y ninguna limpieza de volúmenes lo puede borrar.
- Backend y wwebjs se encuentran por alias fijos en la red `coolify`: `detucel-backend` y
  `detucel-wwebjs` (Coolify conserva los alias de red). "backend" a secas no sirve ahí: otra
  aplicación del servidor también tiene un "backend" en esa red.

Archivos: `docker-compose.wwebjs.yml` (el recurso nuevo) y, en la rama `wwebjs-corte`, el
`docker-compose.yml` principal sin wwebjs y con el ancla.

---

## Preparar (no corta nada)

1. **Crear el recurso en Coolify** (mismo proyecto):
   - *Add Resource* → el mismo repositorio de GitHub → rama `main` → Build Pack **Docker Compose**.
   - Base Directory `/` · Docker Compose Location **`/docker-compose.wwebjs.yml`**.
   - Variables de entorno: `WWEBJS_API_SECRET`, `PROXY_SERVER`, `PROXY_USERNAME`,
     `PROXY_PASSWORD`, `PROXY_ONLY_SESSIONS`, con **los mismos valores** del recurso principal.
   - **Auto Deploy: apagado.** Sin dominio.
   - **No lo despliegues todavía.**

2. **Crear el volumen alias** (terminal del servidor). El uuid del recurso nuevo sale de la URL en
   Coolify o de:
   ```
   docker exec coolify-db psql -U coolify -d coolify -At -c "select uuid, name from applications order by id desc limit 3"
   ```
   ```
   docker volume create --driver local --opt type=none --opt o=bind \
     --opt device=/var/lib/docker/volumes/dpwlknbsbuvups4fy4kahcyk_wwebjs-sessions/_data \
     <uuid nuevo>_wwebjs-sessions
   docker run --rm -v <uuid nuevo>_wwebjs-sessions:/s busybox:1.36.1 ls /s
   ```
   La última línea debe listar los `session-*`.

## El corte (~5 min, fuera del horario de envíos)

3. **Detener el wwebjs actual, con tiempo para guardar:**
   ```
   docker stop -t 30 $(docker ps -q --filter name=wwebjs-dpwlknbsbuvups4fy4kahcyk)
   ```

4. **Desplegar el recurso wwebjs nuevo** (Coolify → Deploy) y mirar sus logs:
   - Bien: las sesiones se restauran una cada 15 s.
   - "No hay perfiles de sesión…": falta el alias del paso 2. Detén el recurso, `docker volume rm` del
     volumen vacío que creó Docker, crea el alias y vuelve a desplegar.
   - "Session storage is in use…": el wwebjs viejo sigue corriendo. Repite el paso 3.

5. **Merge del corte** (rama `wwebjs-corte` → `main`): quita `wwebjs` del compose principal, agrega el
   ancla y el backend pasa a `http://detucel-wwebjs:3001`. Mientras se construye (~3 min) el backend
   todavía apunta al viejo: los envíos de esos minutos fallan, por eso va fuera del horario de envíos.

6. **Verificar:**
   - En la terminal del backend: `getent hosts detucel-wwebjs` da una IP.
   - En *Instancias* todas las sesiones en "Conectada"; manda un mensaje de prueba.
   - Luego la rama `wwebjs-corte` se integra también en `dev`.

### Lo que pasó distinto en el corte real (para la próxima vez)

- El recurso principal usa la fuente "Public GitHub": un push a `main` **no** lo despliega solo; se
  despliega desde el panel (o la API). Por eso antes se hacía "redeploy" a mano.
- Coolify **sí** quitó el contenedor wwebjs viejo al desplegar el compose sin él (no lo dejó huérfano).
- Mientras esperaba el candado, Coolify dejó de reiniciar el contenedor nuevo tras varios intentos
  ("Exited (1)"); hubo que arrancarlo a mano (`docker start`) en cuanto el viejo desapareció.
- `WWEBJS_URL=http://wwebjs:3001` estaba guardada como variable en Coolify y ganaba sobre el valor
  del compose: se cambió a `http://detucel-wwebjs:3001`.
- Los perfiles desvinculados (marco-wa, tania-sesion-3, tania-sesion-4) muestran QR al arrancar y el
  servicio los cierra solo a los 3 min sin uso: es lo normal, pasaba igual antes.

## Vuelta atrás

- **Antes del paso 5:** detén el recurso nuevo en Coolify y
  `docker start $(docker ps -aq --filter name=wwebjs-dpwlknbsbuvups4fy4kahcyk)`. Queda como antes.
- **Después del paso 5:** detén el recurso nuevo y revierte el merge del corte (`git revert`); el
  despliegue vuelve a crear `wwebjs` en el compose principal con el mismo volumen.

## Nunca

- Activar **"Delete Unused Volumes"** en la limpieza de Docker del servidor en Coolify, ni correr
  `docker volume prune` (hoy está apagado).
- Borrar el volumen `dpwlknbsbuvups4fy4kahcyk_wwebjs-sessions`, ni eliminar el recurso principal con
  la opción de borrar sus volúmenes.
- Tener los dos wwebjs corriendo (el candado lo impide, pero no lo fuerces).

Borrar el recurso wwebjs o su volumen alias sí es seguro: el alias solo apunta a la carpeta.

## Después

- Desplegar backend o frontend (Deploy de `whatsapp-scraper-stack`) ya no reinicia WhatsApp.
- Cambios en `apps/wwebjs`: **Deploy manual** del recurso `wwebjs`, fuera del horario de envíos.
- Variables de WhatsApp (`WWEBJS_API_SECRET`, `PROXY_*`): ahora viven en el recurso `wwebjs`. Si se
  cambia `WWEBJS_API_SECRET`, cambiarla en los dos recursos.
