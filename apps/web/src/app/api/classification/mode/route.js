import { NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const token = request.headers.get('x-user-token')
    const response = await fetch(`${process.env.BACKEND_URL || 'http://localhost:8000'}/api/classification/mode`, {
      cache: 'no-store', headers: token ? { 'x-user-token': token } : {},
    })
    return NextResponse.json(await response.json(), { status: response.status })
  } catch {
    return NextResponse.json({ detail: 'No se pudo comprobar la disponibilidad del análisis.' }, { status: 502 })
  }
}
