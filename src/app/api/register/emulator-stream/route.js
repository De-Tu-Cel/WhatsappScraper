import { NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
const B = process.env.BACKEND_URL || 'http://localhost:8000'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const phone    = searchParams.get('phone') || ''
  const instance = searchParams.get('instance') || 'telnyx-01'

  try {
    const upstream = await fetch(
      `${B}/api/register/emulator-stream?phone=${encodeURIComponent(phone)}&instance=${encodeURIComponent(instance)}`,
      { headers: { 'Accept': 'text/event-stream' } }
    )
    return new Response(upstream.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
