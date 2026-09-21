export const dynamic = 'force-dynamic'

import http from 'node:http'
import https from 'node:https'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

export async function GET() {
  return new Promise((resolve) => {
    const url = new URL(`${BACKEND_URL}/api/analytics/stream`)
    const client = url.protocol === 'https:' ? https : http

    const req = client.get(url.toString(), {
      headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
    }, (res) => {
      if (res.statusCode !== 200) {
        resolve(new Response('SSE unavailable', { status: 503 }))
        return
      }

      const stream = new ReadableStream({
        start(controller) {
          res.on('data', (chunk) => controller.enqueue(chunk))
          res.on('end', () => controller.close())
          res.on('error', (err) => controller.error(err))
        },
      })

      resolve(new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, must-revalidate',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      }))
    })

    req.on('error', () => resolve(new Response('SSE unavailable', { status: 503 })))
  })
}
