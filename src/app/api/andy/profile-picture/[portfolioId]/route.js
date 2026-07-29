import { NextResponse } from 'next/server'
import { andyFetch } from '@/lib/andyFetch'

const ANDY_BASE = 'https://dashboard-wa.detucel.com'
const BOT_TOKEN = 'tok_725db09b301a585834af56e85eca5d079dfccd0a5af7ab451f5a5cbaf0491084'
const BOT_MAIL  = 'comercial@detucel.mx'

export async function PUT(request, { params }) {
  const { portfolioId } = await params
  const phoneNumberId   = request.headers.get('x-phone-number-id') || ''
  const body = await request.json()

  try {
    const r = await andyFetch(`${ANDY_BASE}/api/bot-builder/${portfolioId}/profile-picture`, {
      method: 'PUT',
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
    console.error('[andy/profile-picture]', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
