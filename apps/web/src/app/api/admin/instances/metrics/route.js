import { NextResponse } from 'next/server'
const B = process.env.BACKEND_URL || 'http://localhost:8000'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const token = request.headers.get('x-user-token') || ''
  const { searchParams } = new URL(request.url)
  const range = searchParams.get('range') || 'week'
  const year = searchParams.get('year')
  const month = searchParams.get('month')
  const qs = new URLSearchParams({ range })
  if (year) qs.set('year', year)
  if (month) qs.set('month', month)
  try {
    const res = await fetch(`${B}/api/admin/instances/metrics?${qs}`, {
      headers: { 'x-user-token': token },
    })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}
