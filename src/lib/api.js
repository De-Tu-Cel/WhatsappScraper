/**
 * Fetch wrapper that automatically includes the user session token
 * in every request to the backend API.
 */
export function authFetch(url, options = {}) {
  const token = typeof window !== 'undefined'
    ? localStorage.getItem('user_token')
    : null
  const headers = { ...(options.headers || {}) }
  if (token) headers['x-user-token'] = token
  return fetch(url, { ...options, headers })
}
