import { NextResponse } from 'next/server'
import { backendFetch } from '../../../../lib/backendFetch'

export const dynamic = 'force-dynamic'

// Asignar un proxy reinicia la sesión de WhatsApp y revisar la lista sale por cada proxy:
// las dos cosas pueden tardar más que los 20 s por defecto de backendFetch.
const SLOW_MS = 90_000

async function proxy(request, { params }) {
  const { path } = await params
  const subpath = Array.isArray(path) ? path.join('/') : path

  try {
    const forwardHeaders = { 'Content-Type': 'application/json' }
    const token = request.headers.get('x-user-token')
    if (token) forwardHeaders['x-user-token'] = token
    const init = { method: request.method, headers: forwardHeaders, signal: AbortSignal.timeout(SLOW_MS) }
    if (request.method !== 'GET' && request.method !== 'DELETE') {
      init.body = await request.text()
    }
    const res = await backendFetch(`/api/proxies/${subpath}`, init)
    const text = await res.text()
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export const GET    = proxy
export const POST   = proxy
export const PUT    = proxy
export const PATCH  = proxy
export const DELETE = proxy
