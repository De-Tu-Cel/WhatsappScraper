/**
 * Proxy de la evaluación del canal WhatsApp hacia el backend (pasa x-user-token y
 * devuelve la respuesta tal cual). Los ids se validan antes de armar la ruta.
 */
import { NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'
export const ID_RE = /^[a-f0-9]{24}$/
export const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/

export async function forward(request, path, { method = 'GET', body } = {}) {
  const headers = {}
  const token = request.headers.get('x-user-token')
  if (token) headers['x-user-token'] = token
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, { method, headers, body, cache: 'no-store' })
    const out = new NextResponse(await res.arrayBuffer(), { status: res.status })
    for (const h of ['content-type', 'content-disposition', 'cache-control', 'x-robots-tag', 'referrer-policy']) {
      const v = res.headers.get(h)
      if (v) out.headers.set(h, v)
    }
    return out
  } catch (error) {
    return NextResponse.json({ detail: `No se pudo contactar al backend: ${error.message}` }, { status: 502 })
  }
}

export function notFound() {
  return NextResponse.json({ detail: 'Evaluación no encontrada' }, { status: 404 })
}
