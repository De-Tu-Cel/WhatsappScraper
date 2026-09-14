import { NextResponse } from 'next/server'
import { backendFetch } from '@/lib/backendFetch'

export const dynamic = 'force-dynamic'

// Proxies the multipart upload straight through — the browser's Content-Type
// (with its multipart boundary) must be forwarded as-is, never re-encoded.
export async function POST(request) {
  const token = request.headers.get('x-user-token') || ''
  try {
    const contentType = request.headers.get('content-type') || ''
    const body = await request.arrayBuffer()
    const res = await backendFetch('/api/files/upload', {
      method: 'POST',
      headers: { 'Content-Type': contentType, ...(token ? { 'x-user-token': token } : {}) },
      body,
    })
    const text = await res.text()
    return new NextResponse(text, { status: res.status, headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
