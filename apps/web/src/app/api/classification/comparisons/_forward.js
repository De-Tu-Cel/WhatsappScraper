import { NextResponse } from 'next/server'

const B = process.env.BACKEND_URL || 'http://localhost:8000'

// Reenvía al backend la ruta de comparación de clasificadores, con el token del usuario.
export async function forward(request, path, method = 'GET') {
  try {
    const headers = { 'Content-Type': 'application/json' }
    const token = request.headers.get('x-user-token')
    if (token) headers['x-user-token'] = token
    const body = method === 'POST' ? JSON.stringify(await request.json().catch(() => ({}))) : undefined
    const res = await fetch(`${B}/api/classification/comparisons${path}`, { method, headers, body, cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch (error) {
    return NextResponse.json({ detail: error.message }, { status: 500 })
  }
}
