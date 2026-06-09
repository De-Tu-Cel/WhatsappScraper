import { NextResponse } from 'next/server'
const B = process.env.BACKEND_URL || 'http://localhost:8000'

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  const { name } = await params
  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type') || 'status'
  const path = type === 'qr' ? `qr/${name}` : `status/${name}`
  try {
    const res = await fetch(`${B}/api/evolution/instance/${path}`)
    return NextResponse.json(await res.json(), { status: res.status })
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}

export async function DELETE(request, { params }) {
  const { name } = await params
  try {
    const res = await fetch(`${B}/api/evolution/instance/${name}`, { method: 'DELETE' })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}
