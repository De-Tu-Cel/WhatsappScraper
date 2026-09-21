import { NextResponse } from 'next/server'
const B = process.env.BACKEND_URL || 'http://localhost:8000'

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  const { wasender_id } = await params
  try {
    const res = await fetch(`${B}/api/wasender/session/${wasender_id}/restart`, { method: 'POST' })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}
