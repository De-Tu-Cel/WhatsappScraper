import { NextResponse } from 'next/server'
import { backendFetch } from '../../../lib/backendFetch'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const token = request.headers.get('x-user-token')
    const res = await backendFetch('/api/proxies', { headers: token ? { 'x-user-token': token } : {} })
    return new NextResponse(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
