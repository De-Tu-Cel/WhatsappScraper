import { NextResponse } from 'next/server'
const B = process.env.BACKEND_URL || 'http://localhost:8000'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  const token = request.headers.get('x-user-token') || ''
  try {
    const res = await fetch(`${B}/api/admin/instances/sync-wasender`, {
      method: 'POST',
      headers: { 'x-user-token': token },
    })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}
