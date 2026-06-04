import { NextResponse } from 'next/server'
const B = process.env.BACKEND_URL || 'http://localhost:8000'

async function proxy(request, action, method = 'POST') {
  try {
    const token = request.headers.get('x-user-token')
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers['x-user-token'] = token
    const opts = { method, headers }
    if (method !== 'GET') {
      try { opts.body = JSON.stringify(await request.json()) } catch {}
    }
    const res = await fetch(`${B}/api/auth/${action}`, opts)
    return NextResponse.json(await res.json(), { status: res.status })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(request, { params }) {
  const { action } = await params
  return proxy(request, action, 'POST')
}

export async function GET(request, { params }) {
  const { action } = await params
  return proxy(request, action, 'GET')
}

export async function PATCH(request, { params }) {
  const { action } = await params
  return proxy(request, action, 'PATCH')
}
