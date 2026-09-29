import { NextResponse } from 'next/server'
const B = process.env.BACKEND_URL || 'http://localhost:8000'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const country = searchParams.get('country') || '54'
    const token = request.headers.get('x-user-token')
    const headers = {}
    if (token) headers['x-user-token'] = token
    const r = await fetch(`${B}/api/smsfast/info?country=${country}`, { headers, cache: 'no-store' })
    const data = await r.json()
    return NextResponse.json(data, { status: r.status })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
