import { NextResponse } from 'next/server'
const B = process.env.BACKEND_URL || 'http://localhost:8000'

export const dynamic = 'force-dynamic'

export async function DELETE(request, { params }) {
  const { wasender_id } = await params
  try {
    const res = await fetch(`${B}/api/wasender/session/${wasender_id}`, { method: 'DELETE' })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}

export async function PUT(request, { params }) {
  const { wasender_id } = await params
  try {
    const body = await request.json()
    const res = await fetch(`${B}/api/wasender/session/${wasender_id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}
