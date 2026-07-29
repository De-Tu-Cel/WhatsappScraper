import { NextResponse } from 'next/server'
const B = process.env.BACKEND_URL || 'http://localhost:8000'

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))
    const r = await fetch(`${B}/api/register/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await r.json()
    return NextResponse.json(data, { status: r.status })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
