import { NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'

async function forward(request, context, method) {
  const { action } = await context.params
  if ((method === 'GET' && action !== 'status') || (method === 'POST' && action !== 'check')) {
    return NextResponse.json({ detail: 'Operación inválida' }, { status: 404 })
  }
  try {
    const response = await fetch(`${process.env.BACKEND_URL || 'http://localhost:8000'}/api/services/${action}`, {
      method, cache: 'no-store',
      headers: { 'x-user-token': request.headers.get('x-user-token') || '', 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: JSON.stringify(await request.json()) } : {}),
    })
    return NextResponse.json(await response.json(), { status: response.status })
  } catch {
    return NextResponse.json({ detail: 'No se pudo consultar el proveedor.' }, { status: 502 })
  }
}
export const GET = (request, context) => forward(request, context, 'GET')
export const POST = (request, context) => forward(request, context, 'POST')
