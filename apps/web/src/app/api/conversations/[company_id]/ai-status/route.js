import { NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

export async function GET(request, { params }) {
  try {
    const { company_id } = await params
    const token = request.headers.get('x-user-token')
    const headers = {}
    if (token) headers['x-user-token'] = token
    const res = await fetch(`${BACKEND_URL}/api/conversations/${company_id}/ai-status`, { headers })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ ai_enabled: false, ai_active: false, ai_typing: false, turn_count: 0 }, { status: 200 })
  }
}
