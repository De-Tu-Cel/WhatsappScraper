import { NextResponse } from 'next/server'
import { backendFetch } from '../../../../../lib/backendFetch'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const token = request.headers.get('x-user-token') || ''
  try {
    const res = await backendFetch('/api/evolution/instances/user-status', {
      headers: { 'x-user-token': token },
    })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}
