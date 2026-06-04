import { NextResponse } from 'next/server'
import { proxyPost } from '../_proxy'

export async function POST(request) {
  try {
    const res  = await proxyPost(request, '/api/process-url')
    return NextResponse.json(await res.json(), { status: res.status })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}