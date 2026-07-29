import { NextResponse } from 'next/server'
import { andyFetch } from '@/lib/andyFetch'

const ANDY_BASE = 'https://dashboard-wa.detucel.com'
const BOT_TOKEN = 'tok_725db09b301a585834af56e85eca5d079dfccd0a5af7ab451f5a5cbaf0491084'
const BOT_MAIL  = 'comercial@detucel.mx'

export async function GET() {
  try {
    const url = `${ANDY_BASE}/api/bot-builder/OwnWA/commercials`
    console.log('[andy/commercials] GET', url, { token: BOT_TOKEN.slice(0,12)+'...', mail: BOT_MAIL })
    const r = await andyFetch(url, {
      headers: { 'Authorization': `Bearer ${BOT_TOKEN}`, mail: BOT_MAIL },
    })
    const raw = r.text()
    console.log('[andy/commercials] status:', r.status, 'raw:', raw.slice(0, 500))
    console.log('[andy/commercials] headers sent → token:', BOT_TOKEN.slice(0,20)+'...', 'mail:', BOT_MAIL)
    let data; try { data = JSON.parse(raw) } catch { data = { raw } }
    return NextResponse.json(data, { status: r.status })
  } catch (e) {
    console.error('[andy/commercials]', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
