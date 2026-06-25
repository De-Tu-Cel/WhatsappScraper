import { NextResponse } from 'next/server'
import { andyFetch } from '@/lib/andyFetch'

const ANDY_BASE = 'https://dashboard-wa.detucel.com'
const BOT_TOKEN = 'tok_878bbaf38f2a508c0ae9dbea2b84b7b35d6ec5d0b136ef5096dab4645d93be23'
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
