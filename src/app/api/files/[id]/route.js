import { NextResponse } from 'next/server'
import { backendFetch } from '@/lib/backendFetch'

export const dynamic = 'force-dynamic'

// Serves a GridFS-stored file back through the frontend's own public domain —
// APP_PUBLIC_URL points at this same app, so image/document URLs saved in
// message_logs (media_url) must resolve here, not just against the backend
// container's internal-only address.
export async function GET(request, { params }) {
  const { id } = await params
  try {
    const res = await backendFetch(`/api/files/${id}`)
    const buf = await res.arrayBuffer()
    return new NextResponse(buf, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('content-type') || 'application/octet-stream',
        'Content-Disposition': res.headers.get('content-disposition') || 'inline',
        'Cache-Control': res.headers.get('cache-control') || 'public, max-age=86400',
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
