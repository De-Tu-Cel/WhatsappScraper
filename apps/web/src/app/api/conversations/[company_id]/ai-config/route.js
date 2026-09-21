import { NextResponse } from 'next/server'

const B = process.env.BACKEND_URL || 'http://localhost:8000'

export async function GET(request, { params }) {
  try {
    const { company_id } = await params
    const res = await fetch(`${B}/api/conversations/${company_id}/ai-config`)
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PUT(request, { params }) {
  try {
    const { company_id } = await params
    const body = await request.json()
    const res = await fetch(`${B}/api/conversations/${company_id}/ai-config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
