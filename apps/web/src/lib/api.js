/**
 * Fetch wrapper that automatically includes the user session token
 * in every request to the backend API.
 * On 401: clears the stored token so polling guards stop immediately.
 */
const sendRequests = new Map()

export async function authFetch(url, options = {}) {
  const token = typeof window !== 'undefined'
    ? localStorage.getItem('user_token')
    : null
  const headers = { ...(options.headers || {}) }
  if (token) headers['x-user-token'] = token
  let requestKey
  let body = options.body
  if (options.method?.toUpperCase() === 'POST' && ['/api/send-message', '/api/send-queue'].includes(String(url))) {
    const payload = JSON.parse(body || '{}')
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([token, url, payload])))
    requestKey = 'send-request:' + Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('')
    const active = sendRequests.get(requestKey)
    if (active) return (await active).clone()
    let stored
    try { stored = sessionStorage.getItem(requestKey) } catch {}
    payload.request_id ||= stored || crypto.randomUUID()
    try { sessionStorage.setItem(requestKey, payload.request_id) } catch {}
    body = JSON.stringify(payload)
  }
  const pending = (async () => {
    const response = await fetch(url, { ...options, body, headers })
    // Receiving headers does not prove the response body arrived. Keep the
    // operation ID if the connection breaks before the complete JSON arrives.
    if (requestKey) await response.clone().json()
    return response
  })()
  if (requestKey) sendRequests.set(requestKey, pending)
  let res
  try {
    res = await pending
    // Keep the same operation ID after network errors or uncertain delivery.
    if (requestKey && (res.ok || [400, 401, 403, 422].includes(res.status))) {
      try { sessionStorage.removeItem(requestKey) } catch {}
    }
  } finally {
    if (requestKey) sendRequests.delete(requestKey)
  }
  if (res.status === 401 && typeof window !== 'undefined') {
    localStorage.removeItem('user_token')
  }
  if (res.status === 503 && typeof window !== 'undefined' && !String(url).includes('/api/services/')) {
    window.dispatchEvent(new Event('service-health-refresh'))
  }
  return requestKey ? res.clone() : res
}
