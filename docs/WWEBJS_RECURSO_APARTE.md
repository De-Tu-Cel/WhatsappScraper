# WhatsApp (wwebjs) como recurso aparte en Coolify

**Por qué:** `wwebjs` vive en el mismo `docker-compose.yml` que el backend y el frontend, así que
**cada despliegue** (un merge a `main`, un cambio de variable) reinicia también todas las sesiones de
WhatsApp. El 2026-10-20 la sesión de gely se cayó con el despliegue de las 21:05. Separado en su
propio recurso, desplegar el backend ya no toca WhatsApp; `wwebjs` solo se reinicia cuando se
despliega a mano.

**Lo que no cambia:** las sesiones. El recurso nuevo usa **el mismo volumen** de perfiles (no una
copia), así que ningún número se vuelve a vincular. El candado de `storage-entrypoint.sh` impide que
dos servicios usen esos perfiles a la vez (WhatsApp desvincularía los números si se conectan desde
dos lados). Y si por error se montara un volumen vacío, el servicio nuevo **no arranca**
(`REQUIRE_EXISTING_SESSIONS=1`) para que nadie vincule números en el lugar equivocado.

Archivos: `docker-compose.wwebjs.yml` (el recurso nuevo) y `docker-compose.yml` (el principal).
Backend y wwebjs se encuentran por alias fijos en la red `coolify`: `detucel-backend` y `detucel-wwebjs`.

---

## Fase 1 — Preparar (no corta nada)

1. **Merge de `dev` → `main`.** Trae los alias y el compose nuevo; el backend sigue hablando con
   `wwebjs` como siempre. Este despliegue todavía reinicia WhatsApp (es el último): hazlo fuera del
   horario de envíos y junto con cualquier otra variable pendiente.

2. **Comprobar que Coolify respeta los alias.** En la terminal del contenedor **backend**:
   ```
   getent hosts detucel-wwebjs
   getent hosts detucel-backend
   ```
   Las dos deben imprimir una IP. Si alguna sale vacía, **no sigas**: avisa (habría que usar otro
   método para que se encuentren).

3. **Nombre del volumen de sesiones.** En la terminal del servidor (Coolify → Servers → Terminal, o SSH):
   ```
   docker ps --format '{{.Names}}' | grep wwebjs
   docker inspect <ese contenedor> --format '{{range .Mounts}}{{if eq .Destination "/app/sessions"}}{{.Name}}{{end}}{{end}}'
   ```
   Anota el nombre del contenedor y el del volumen.

4. **Crear el recurso en Coolify** (mismo proyecto):
   - *Add Resource* → el mismo repositorio de GitHub → rama `main` → Build Pack **Docker Compose**.
   - Base Directory `/` · Docker Compose Location **`/docker-compose.wwebjs.yml`**.
   - Variables de entorno: `WWEBJS_API_SECRET`, `PROXY_SERVER`, `PROXY_USERNAME`,
     `PROXY_PASSWORD`, `PROXY_ONLY_SESSIONS` (**los mismos valores** que en el recurso principal) y
     `WWEBJS_SESSIONS_VOLUME` = el nombre del paso 3.
   - **Auto Deploy: apagado.** Sin dominio.
   - **No lo despliegues todavía.** (Si Coolify lo arrancara solo, no pasa nada: ve el candado del
     servicio actual, dice "Session storage is in use… refusing to start" y no toca las sesiones.
     Detenlo.)

## Fase 2 — El corte (~5 min, fuera del horario de envíos)

5. **Detener el wwebjs actual, con tiempo para guardar** (terminal del servidor):
   ```
   docker stop -t 30 <contenedor del paso 3>
   ```

6. **Desplegar el recurso wwebjs nuevo** (Coolify → Deploy) y mirar sus logs:
   - Bien: las sesiones se restauran una cada 15 s.
   - "No hay perfiles de sesión…": volumen equivocado. Detén el recurso y revisa `WWEBJS_SESSIONS_VOLUME`.
   - "Session storage is in use…": el wwebjs viejo sigue corriendo. Repite el paso 5.

7. **Merge del corte** (rama `wwebjs-corte` → `main`): quita `wwebjs` del compose principal y el backend
   pasa a `http://detucel-wwebjs:3001`. Mientras se construye (~3 min) el backend todavía apunta al
   viejo: los envíos de esos minutos fallan, por eso va fuera del horario de envíos. Los mensajes que
   llegan sí entran (wwebjs → `detucel-backend`).

8. **Verificar:** en *Instancias* todas las sesiones en "Conectada"; manda un mensaje de prueba.
   Luego la rama `wwebjs-corte` se integra también en `dev`.

## Vuelta atrás

- **Antes del paso 7** (el backend todavía usa `http://wwebjs:3001`): detén el recurso nuevo en
  Coolify y `docker start <contenedor del paso 3>`. Queda exactamente como antes.
- **Después del paso 7:** detén el recurso nuevo y revierte el merge del corte (`git revert`); el
  despliegue vuelve a crear `wwebjs` en el compose principal con el mismo volumen.
- Nunca: borrar volúmenes del recurso principal en Coolify, ni tener los dos wwebjs corriendo.

## Después

- Desplegar backend o frontend ya no reinicia WhatsApp.
- Cambios en `apps/wwebjs`: **Deploy manual** del recurso wwebjs, fuera del horario de envíos.
