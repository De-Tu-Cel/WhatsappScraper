import { NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
const B = process.env.BACKEND_URL || 'http://localhost:8000'

export async function POST(req, { params }) {
  const { company_id } = await params
  const suffix = new URL(req.url).pathname.endsWith('/reset') ? '/reset' : ''
  try {
    const res = await fetch(`${B}/api/admin/test-analyzing/${company_id}${suffix}`, { method: 'POST' })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
