import { NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

export async function GET(request, { params }) {
  try {
    const { company_id } = await params
    const token = request.headers.get('x-user-token')
    const headers = {}
    if (token) headers['x-user-token'] = token
    const res = await fetch(`${BACKEND_URL}/api/conversations/${company_id}`, { headers })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request, { params }) {
  try {
    const { company_id } = await params
    const token = request.headers.get('x-user-token')
    const headers = {}
    if (token) headers['x-user-token'] = token
    const res = await fetch(`${BACKEND_URL}/api/conversations/${company_id}/read`, { method: 'POST', headers })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
