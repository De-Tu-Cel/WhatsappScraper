import { NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
const B = process.env.BACKEND_URL || 'http://localhost:8000'

export async function GET(request) {
  try {
    const token = request.headers.get('x-user-token') || ''
    const qs = new URL(request.url).searchParams.toString()
    const res = await fetch(`${B}/api/contacts/search${qs ? `?${qs}` : ''}`, {
      headers: { 'x-user-token': token },
      cache: 'no-store',
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status, headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
