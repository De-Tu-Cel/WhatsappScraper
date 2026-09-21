import { NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
const B = process.env.BACKEND_URL || 'http://localhost:8000'

export async function GET(request) {
  try {
    const token = request.headers.get('x-user-token') || ''
    const lang = new URL(request.url).searchParams.get('lang') || 'es'
    const res = await fetch(`${B}/api/admin/message-templates?lang=${encodeURIComponent(lang)}`, {
      headers: { 'x-user-token': token },
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const token = request.headers.get('x-user-token') || ''
    const body = await request.json()
    const res = await fetch(`${B}/api/admin/message-templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-token': token },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
