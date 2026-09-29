import { NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const token = request.headers.get('x-user-token')
    const headers = {}
    if (token) headers['x-user-token'] = token
    const res = await fetch(`${BACKEND_URL}/api/companies?${searchParams.toString()}`, { headers })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const body = await request.json()
    const token = request.headers.get('x-user-token')
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers['x-user-token'] = token
    const res = await fetch(`${BACKEND_URL}/api/companies`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(request) {
  try {
    const body = await request.json()
    const token = request.headers.get('x-user-token')
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers['x-user-token'] = token
    const res = await fetch(`${BACKEND_URL}/api/companies`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify(body),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
