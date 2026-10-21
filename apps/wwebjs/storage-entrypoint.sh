#!/bin/sh
set -eu
umask 077
storage="${SESSIONS_PATH:-/app/sessions}"
mkdir -p "$storage"
# Recurso aparte en Coolify (docs/WWEBJS_RECURSO_APARTE.md): ahí el volumen de producción se
# monta como externo por nombre. Si el nombre no coincide, Coolify/Docker monta uno vacío;
# arrancar así llevaría a vincular los números en el volumen equivocado. Mejor no arrancar
# (la pausa evita un ciclo de reinicios a toda velocidad).
if [ "${REQUIRE_EXISTING_SESSIONS:-0}" = "1" ] && ! ls -d "$storage"/session-* >/dev/null 2>&1; then
  echo "No hay perfiles de sesión (session-*) en $storage: no parece el volumen de producción." >&2
  echo "Revisa WWEBJS_SESSIONS_VOLUME. No se arranca para no vincular números en otro volumen." >&2
  sleep "${EMPTY_STORAGE_PAUSE:-30}"
  exit 1
fi
export SESSION_STORAGE_LOCKED=1
# The kernel releases this lock after a crash too. Never unlink the lock file.
# The lock lives on fd 9, which node inherits through `exec`: node itself is
# PID 1's child that holds it, so Docker's stop signal reaches node directly.
# (Was `flock --no-fork`, which only exists in util-linux >= 2.39 — on an older
# base image the container would fail to start and loop on restart.)
# `>>` so opening it never truncates the file.
exec 9>>"$storage/.service.lock"
if ! flock --nonblock 9; then
  echo "Session storage is in use by another wwebjs service; refusing to start." >&2
  exit 1
fi
exec node index.js
