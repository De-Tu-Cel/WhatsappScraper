import { NextResponse } from 'next/server'
import { backendFetch } from '@/lib/backendFetch'
export const dynamic = 'force-dynamic'
export async function GET(request) {
  try {
    const query = new URL(request.url).searchParams.toString()
    const response = await backendFetch(`/api/blacklist/check?${query}`, { headers: { 'x-user-token': request.headers.get('x-user-token') || '' }, cache: 'no-store' })
    return NextResponse.json(await response.json(), { status: response.status, headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'No se pudo comprobar la regla' }, { status: 502 })
  }
}
