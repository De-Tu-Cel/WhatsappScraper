import { NextResponse } from 'next/server'
import { backendFetch } from '../../../lib/backendFetch'

export async function GET() {
  try {
    const res = await backendFetch('/api/conversations')
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
