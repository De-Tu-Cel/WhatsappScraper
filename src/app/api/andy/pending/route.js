import { NextResponse } from 'next/server'
import { andyFetch } from '@/lib/andyFetch'

const ANDY_BASE = 'https://dashboard-wa.detucel.com'
const BOT_TOKEN = 'tok_725db09b301a585834af56e85eca5d079dfccd0a5af7ab451f5a5cbaf0491084'
const BOT_MAIL  = 'comercial@detucel.mx'

export async function POST(request) {
  let payload
  try {
    payload = await request.json()
  } catch (e) {
    return NextResponse.json({ ok: false, error: `Body inválido: ${e.message}` }, { status: 400 })
  }

  const endpoint = request.headers.get('x-andy-endpoint') || '/api/pending'
  const path     = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
  const url      = `${ANDY_BASE}${path}`

  try {
    const r        = await andyFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${BOT_TOKEN}`, mail: BOT_MAIL },
      body: JSON.stringify(payload),
    })
    const andyBody = r.json()

    if (!r.ok) {
      console.error(`[andy/pending] Andy respondió ${r.status}:`, andyBody)
      return NextResponse.json({ ok: false, andyStatus: r.status, andyBody }, { status: r.status })
    }

    return NextResponse.json({ ok: true, andyStatus: r.status, andyBody })
  } catch (e) {
    console.error('[andy/pending] fetch error:', e.message)
    return NextResponse.json({ ok: false, error: e.message, url }, { status: 500 })
  }
}
