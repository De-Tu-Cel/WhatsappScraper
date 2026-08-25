import { NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
const B = process.env.BACKEND_URL || 'http://localhost:8000'

export async function GET(request, { params }) {
  try {
    const { id } = await params
    const token = request.headers.get('x-user-token') || ''
    const res = await fetch(`${B}/api/scrape-jobs/${id}`, {
      headers: { 'x-user-token': token },
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function PATCH(request, { params }) {
  try {
    const { id } = await params
    const token = request.headers.get('x-user-token') || ''
    const body = await request.json()
    const res = await fetch(`${B}/api/scrape-jobs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-user-token': token },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
