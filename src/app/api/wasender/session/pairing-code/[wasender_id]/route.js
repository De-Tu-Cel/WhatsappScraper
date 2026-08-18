import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST() {
  return NextResponse.json(
    { error: 'Pairing code no soportado por WasenderAPI. Usa QR para vincular.' },
    { status: 410 }
  )
}
