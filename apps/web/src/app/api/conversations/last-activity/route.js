import { NextResponse } from 'next/server'

const B = process.env.BACKEND_URL || 'http://localhost:8000'

export async function GET(request) {
  try {
    const token = request.headers.get('x-user-token')
    const headers = {}
    if (token) headers['x-user-token'] = token
    const res = await fetch(`${B}/api/conversations/last-activity`, { headers })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
