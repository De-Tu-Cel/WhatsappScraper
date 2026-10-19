import { NextResponse } from 'next/server'
import { backendFetch } from '@/lib/backendFetch'
export const dynamic = 'force-dynamic'
export async function GET(request) {
  try {
    const response = await backendFetch('/api/blacklist/stats', { headers: { 'x-user-token': request.headers.get('x-user-token') || '' }, cache: 'no-store' })
    return NextResponse.json(await response.json(), { status: response.status, headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'No se pudieron cargar los totales' }, { status: 502 })
  }
}
