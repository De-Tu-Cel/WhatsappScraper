import https from 'node:https'

const agent = new https.Agent({ rejectUnauthorized: false })

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, */*',
  'Accept-Language': 'es-MX,es;q=0.9',
  'Origin': 'https://dashboard-wa.detucel.com',
  'Referer': 'https://dashboard-wa.detucel.com/',
}

/**
 * fetch wrapper that bypasses TLS verification — for Andy's expired cert.
 */
export async function andyFetch(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || 443,
      path:     parsed.pathname + parsed.search,
      method,
      headers:  { ...BASE_HEADERS, ...headers },
      agent,
    }

    const req = https.request(options, res => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        resolve({
          ok:     res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          json:   () => { try { return JSON.parse(raw) } catch { return {} } },
          text:   () => raw,
        })
      })
    })

    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}
