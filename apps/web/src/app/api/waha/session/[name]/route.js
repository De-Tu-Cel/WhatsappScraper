import { NextResponse } from 'next/server'
const B = process.env.BACKEND_URL || 'http://localhost:8000'

export const dynamic = 'force-dynamic'

export async function DELETE(request, { params }) {
  const { name } = await params
  try {
    const res = await fetch(`${B}/api/waha/session/${name}`, { method: 'DELETE' })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}
