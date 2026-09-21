import { NextResponse } from 'next/server'
import { andyFetch } from '@/lib/andyFetch'

const ANDY_BASE = 'https://dashboard-wa.detucel.com'
const BOT_TOKEN = process.env.ANDY_BOT_TOKEN || ''
const BOT_MAIL  = process.env.ANDY_BOT_MAIL  || ''

export async function POST(request, { params }) {
  const { portfolioId } = await params
  const phoneNumberId   = request.headers.get('x-phone-number-id') || ''
  const body = await request.json()

  try {
    const r = await andyFetch(`${ANDY_BASE}/api/bot-builder/${portfolioId}/build`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BOT_TOKEN}`,
        mail:  BOT_MAIL,
        phone: phoneNumberId,
      },
      body: JSON.stringify(body),
    })
    const data = r.json()
    return NextResponse.json(data, { status: r.status })
  } catch (e) {
    console.error('[andy/build]', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
