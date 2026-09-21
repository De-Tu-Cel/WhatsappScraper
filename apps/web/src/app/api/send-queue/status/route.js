import { NextResponse } from 'next/server'
import { backendFetch } from '../../../../lib/backendFetch'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const token = request.headers.get('x-user-token') || ''
    const res = await backendFetch('/api/send-queue/status', {
      headers: { 'x-user-token': token },
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
