import { NextResponse } from 'next/server'
const B = process.env.BACKEND_URL || 'http://localhost:8000'

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))
    const token = request.headers.get('x-user-token')
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers['x-user-token'] = token
    const r = await fetch(`${B}/api/smsfast/cancel`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    const data = await r.json()
    return NextResponse.json(data, { status: r.status })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
