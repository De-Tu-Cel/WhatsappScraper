import { NextResponse } from 'next/server'

const B = process.env.BACKEND_URL || 'http://localhost:8000'

export async function GET() {
  try {
    const res = await fetch(`${B}/api/conversations/ai-health`)
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (error) {
    return NextResponse.json({ circuit_open: false, business_hours_active: true }, { status: 200 })
  }
}
