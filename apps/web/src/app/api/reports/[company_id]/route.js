import { NextResponse } from 'next/server'

const BACKEND = process.env.BACKEND_URL || 'http://localhost:8000'

export async function POST(request, { params }) {
  const { company_id } = await params
  const body = await request.json()

  const res = await fetch(`${BACKEND}/api/reports/${company_id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ error: text }, { status: res.status })
  }

  const pdfBuffer = await res.arrayBuffer()
  const contentDisposition = res.headers.get('content-disposition') || 'attachment; filename="reporte.pdf"'

  return new Response(pdfBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': contentDisposition,
    },
  })
}
