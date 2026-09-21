import { NextResponse } from 'next/server'
import { backendFetch } from '@/lib/backendFetch'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const token = request.headers.get('x-user-token') || ''
  try {
    const res = await backendFetch('/api/stickers', {
      headers: token ? { 'x-user-token': token } : {},
    })
    const text = await res.text()
    return new NextResponse(text, { status: res.status, headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// Multipart upload — same passthrough approach as /api/files/upload.
export async function POST(request) {
  const token = request.headers.get('x-user-token') || ''
  try {
    const contentType = request.headers.get('content-type') || ''
    const body = await request.arrayBuffer()
    const res = await backendFetch('/api/stickers', {
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

export async function DELETE(request) {
  const token = request.headers.get('x-user-token') || ''
  const { searchParams } = new URL(request.url)
  try {
    const res = await backendFetch(`/api/stickers?url=${encodeURIComponent(searchParams.get('url') || '')}`, {
      method: 'DELETE',
      headers: token ? { 'x-user-token': token } : {},
    })
    const text = await res.text()
    return new NextResponse(text, { status: res.status, headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
