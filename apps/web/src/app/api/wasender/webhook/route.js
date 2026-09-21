import { NextResponse } from 'next/server'
const B = process.env.BACKEND_URL || 'http://localhost:8000'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  try {
    const body = await request.text()
    const res = await fetch(`${B}/api/wasender/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    const text = await res.text()
    return new NextResponse(text, { status: res.status, headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
