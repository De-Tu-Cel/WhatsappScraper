import { NextResponse } from 'next/server'
const B = process.env.BACKEND_URL || 'http://localhost:8000'

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  const { name } = await params
  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type') || 'status'
  const path = type === 'qr' ? `qr/${name}` : `status/${name}`
  try {
    const res = await fetch(`${B}/api/evolution/instance/${path}`)
    return NextResponse.json(await res.json(), { status: res.status })
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}

export async function DELETE(request, { params }) {
  const { name } = await params
  try {
    const res = await fetch(`${B}/api/evolution/instance/${name}`, { method: 'DELETE' })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}

export async function POST(request, { params }) {
  const { name } = await params
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action')
  if (action === 'logout') {
    try {
      const res = await fetch(`${B}/api/evolution/instance/logout/${name}`, { method: 'POST' })
      return NextResponse.json(await res.json(), { status: res.status })
    } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
  }
  if (action === 'pairing-code') {
    try {
      const body = await request.json()
      const res = await fetch(`${B}/api/evolution/instance/pairing-code/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return NextResponse.json(await res.json(), { status: res.status })
    } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
  }
  if (action === 'request-otp') {
    try {
      const body = await request.json()
      const res = await fetch(`${B}/api/evolution/instance/request-otp/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return NextResponse.json(await res.json(), { status: res.status })
    } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
  }
  if (action === 'verify-otp') {
    try {
      const body = await request.json()
      const res = await fetch(`${B}/api/evolution/instance/verify-otp/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return NextResponse.json(await res.json(), { status: res.status })
    } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
