import { NextResponse } from 'next/server'
const B = process.env.BACKEND_URL || 'http://localhost:8000'

export async function POST(request, { params }) {
  try {
    const { action } = await params
    const body  = await request.json().catch(() => ({}))
    const token = request.headers.get('x-user-token')
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers['x-user-token'] = token
    const res = await fetch(`${B}/api/auth/admin/${action}`, {
      method: 'POST', headers, body: JSON.stringify(body),
    })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
