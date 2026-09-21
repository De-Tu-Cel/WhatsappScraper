/**
 * Generic proxy helper — forwards request to backend preserving x-user-token.
 */
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

export async function proxyPost(request, backendPath) {
  const body  = await request.json().catch(() => ({}))
  const token = request.headers.get('x-user-token')
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['x-user-token'] = token
  return fetch(`${BACKEND_URL}${backendPath}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  })
}
