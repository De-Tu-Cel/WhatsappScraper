import { NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const page      = searchParams.get('page')      || '1'
    const page_size = searchParams.get('page_size') || '20'
    const category  = searchParams.get('category')  || ''
    const agents    = searchParams.get('agents')    || ''
    const search    = searchParams.get('search')    || ''
    const catParam    = category ? `&category=${encodeURIComponent(category)}` : ''
    const agentsParam = agents   ? `&agents=${encodeURIComponent(agents)}`     : ''
    const searchParam = search   ? `&search=${encodeURIComponent(search)}`     : ''
    const res  = await fetch(`${BACKEND_URL}/api/analytics?page=${page}&page_size=${page_size}${catParam}${agentsParam}${searchParam}`, { cache: 'no-store' })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
