import { NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
const B = process.env.BACKEND_URL || 'http://localhost:8000'

export async function GET() {
  try {
    const r = await fetch(`${B}/api/telnyx/otp`, { cache: 'no-store' })
    return NextResponse.json(await r.json())
  } catch (e) {
    return NextResponse.json({ otp: null })
  }
}
