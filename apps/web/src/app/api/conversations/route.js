import { NextResponse } from 'next/server'
import { backendFetch } from '../../../lib/backendFetch'

export async function GET(request) {
  try {
    const token = request.headers.get('x-user-token')
    const headers = {}
    if (token) headers['x-user-token'] = token
    const res = await backendFetch('/api/conversations', { headers })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
