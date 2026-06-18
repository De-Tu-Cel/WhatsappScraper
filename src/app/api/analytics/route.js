import { NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const page      = searchParams.get('page')      || '1'
    const page_size = searchParams.get('page_size') || '20'
    const res  = await fetch(`${BACKEND_URL}/api/analytics?page=${page}&page_size=${page_size}`, { cache: 'no-store' })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
