// Only public scraping progress is shared between tabs of the SAME login.
// Session tokens never enter BroadcastChannel messages or persistent storage.
export function createScrapePoller({ fetcher, locks, channel, digest, now = Date.now, waitMs = 22000 }) {
  const active = new Map()
  const latest = new Map()
  const listeners = new Map()
  const fresh = key => {
    const item = latest.get(key)
    return item && now() - item.at < 1500 ? item.value : null
  }
  if (channel) channel.onmessage = ({ data }) => {
    if (!data || typeof data.key !== 'string' || !data.value || typeof data.value.status !== 'number') return
    // Bound the cache: no long-lived history and no persistent copies of results.
    if (data.value.status === 200) {
      latest.delete(data.key)
      latest.set(data.key, { at: now(), value: data.value })
      if (latest.size > 8) latest.delete(latest.keys().next().value)
    }
    for (const resolve of listeners.get(data.key) || []) resolve(data.value)
  }

  return async function poll(url, token, force = false) {
    const key = await digest(`${token}\n${url}`)
    if (active.has(key)) return structuredClone(await active.get(key))
    const request = (async () => {
      if (!force && fresh(key)) return fresh(key)
      const load = async () => {
        const response = await fetcher(url, token)
        const value = { status: response.status, data: response.ok ? await response.json() : null }
        if (value.status === 200) {
          latest.set(key, { at: now(), value })
          if (latest.size > 8) latest.delete(latest.keys().next().value)
        }
        channel?.postMessage({ key, value })
        return value
      }
      if (!locks || !channel) return load()
      // Subscribe before trying the lock, so a fast winner cannot publish
      // between our failed lock attempt and registering the listener.
      let resolveRemote, timer
      const remote = new Promise(resolve => { resolveRemote = resolve })
      const waiters = listeners.get(key) || new Set()
      waiters.add(resolveRemote)
      listeners.set(key, waiters)
      try {
        return await locks.request(`scrape-poll:${key}`, { ifAvailable: true }, async lock => {
          if (lock) return (!force && fresh(key)) || load()
          const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), waitMs) })
          // A closed/crashed tab must not prevent another tab from updating.
          return (await Promise.race([remote, timeout])) || load()
        })
      } finally {
        clearTimeout(timer)
        waiters.delete(resolveRemote)
        if (!waiters.size) listeners.delete(key)
      }
    })()
    active.set(key, request)
    try { return structuredClone(await request) }
    finally { active.delete(key) }
  }
}
