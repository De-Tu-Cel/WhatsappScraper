import { NextResponse } from 'next/server'
const B = process.env.BACKEND_URL || 'http://localhost:8000'

export const dynamic = 'force-dynamic'

export async function DELETE(request, { params }) {
  const { name } = await params
  const token = request.headers.get('x-user-token') || ''
  try {
    const res = await fetch(`${B}/api/admin/instances/${name}`, {
      method: 'DELETE',
      headers: { 'x-user-token': token },
    })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}

export async function POST(request, { params }) {
  const { name } = await params
  const token = request.headers.get('x-user-token') || ''
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action')

  if (action === 'warmup') {
    const body = await request.json().catch(() => ({}))
    try {
      const res = await fetch(`${B}/api/instances/${encodeURIComponent(name)}/warmup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-token': token },
        body: JSON.stringify(body),
      })
      return NextResponse.json(await res.json(), { status: res.status })
    } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
  }

  const backendAction = action === 'unassign' ? `${name}/unassign` : `${name}/assign`
  const body = action === 'unassign' ? {} : await request.json()

  try {
    const res = await fetch(`${B}/api/admin/instances/${backendAction}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-token': token },
      body: JSON.stringify(body),
    })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}
