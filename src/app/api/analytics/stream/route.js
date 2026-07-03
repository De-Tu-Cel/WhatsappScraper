export const dynamic = 'force-dynamic'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

export async function GET() {
  const backendRes = await fetch(`${BACKEND_URL}/api/analytics/stream`, {
    headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
    cache: 'no-store',
  })

  if (!backendRes.ok || !backendRes.body) {
    return new Response('SSE unavailable', { status: 503 })
  }

  return new Response(backendRes.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, must-revalidate',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
