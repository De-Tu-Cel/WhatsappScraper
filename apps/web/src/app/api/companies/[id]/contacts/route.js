import { NextResponse } from 'next/server'
const BACKEND = process.env.BACKEND_URL || 'http://localhost:8000'
export async function PUT(request, { params }) {
  const { id } = await params
  const body = await request.json()
  const res = await fetch(`${BACKEND}/api/companies/${id}/contacts`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
