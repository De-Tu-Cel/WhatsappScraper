import { NextResponse } from 'next/server'

const B = process.env.BACKEND_URL || 'http://localhost:8000'

export async function GET(request) {
  try {
    const token = request.headers.get('x-user-token')
    const headers = {}
    if (token) headers['x-user-token'] = token
    const res = await fetch(`${B}/api/conversations/ai-global-config`, { headers })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PUT(request) {
  try {
    const body = await request.json()
    const token = request.headers.get('x-user-token')
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers['x-user-token'] = token
    const res = await fetch(`${B}/api/conversations/ai-global-config`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
