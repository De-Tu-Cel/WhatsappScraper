import { NextResponse } from 'next/server'
import { backendFetch } from '../../../../lib/backendFetch'

export const dynamic = 'force-dynamic'

async function proxy(request, { params }) {
  const { path } = await params
  const subpath = Array.isArray(path) ? path.join('/') : path

  try {
    const forwardHeaders = { 'Content-Type': 'application/json' }
    const token = request.headers.get('x-user-token')
    if (token) forwardHeaders['x-user-token'] = token
    const init = { method: request.method, headers: forwardHeaders }
    if (request.method !== 'GET' && request.method !== 'DELETE') {
      init.body = await request.text()
    }
    const res = await backendFetch(`/api/warmup/${subpath}`, init)
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
export const DELETE = proxy
