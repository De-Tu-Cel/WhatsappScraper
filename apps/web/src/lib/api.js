/**
 * Fetch wrapper that automatically includes the user session token
 * in every request to the backend API.
 * On 401: clears the stored token so polling guards stop immediately.
 */
export async function authFetch(url, options = {}) {
  const token = typeof window !== 'undefined'
    ? localStorage.getItem('user_token')
    : null
  const headers = { ...(options.headers || {}) }
  if (token) headers['x-user-token'] = token
  const res = await fetch(url, { ...options, headers })
  if (res.status === 401 && typeof window !== 'undefined') {
    localStorage.removeItem('user_token')
  }
  if (res.status === 503 && typeof window !== 'undefined' && !String(url).includes('/api/services/')) {
    window.dispatchEvent(new Event('service-health-refresh'))
  }
  return res
}
