import { NextResponse } from 'next/server'
const B = process.env.BACKEND_URL || 'http://localhost:8000'

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  const { wasender_id } = await params
  try {
    const res = await fetch(`${B}/api/wasender/session/status/${wasender_id}`)
    return NextResponse.json(await res.json(), { status: res.status })
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}
