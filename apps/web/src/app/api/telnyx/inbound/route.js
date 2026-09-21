import { NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
const B = process.env.BACKEND_URL || 'http://localhost:8000'

export async function POST(request) {
  try {
    const body = await request.json()
    const r = await fetch(`${B}/api/telnyx/inbound`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return NextResponse.json(await r.json().catch(() => ({ ok: true })))
  } catch (e) {
    return NextResponse.json({ ok: true })
  }
}
