import { NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
const B = process.env.BACKEND_URL || 'http://localhost:8000'

export async function GET(request) {
  try {
    const token = request.headers.get('x-user-token') || ''
    const since = new URL(request.url).searchParams.get('since') || ''
    const url = since
      ? `${B}/api/notifications/count?since=${encodeURIComponent(since)}`
      : `${B}/api/notifications/count`
    const res = await fetch(url, { headers: { 'x-user-token': token } })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
