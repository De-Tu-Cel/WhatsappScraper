const express = require('express')
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js')
const puppeteerExtra = require('puppeteer-extra')
const StealthPlugin  = require('puppeteer-extra-plugin-stealth')
const QRCode = require('qrcode')
const fs = require('fs')

puppeteerExtra.use(StealthPlugin())

const app = express()
app.use(express.json({ limit: '10mb' }))

const PORT         = process.env.PORT         || 3001
const FASTAPI_URL  = process.env.FASTAPI_URL  || 'http://backend:8000'
const API_SECRET   = process.env.API_SECRET   || ''
const SESSIONS_PATH = process.env.SESSIONS_PATH || '/app/sessions'

// sessionId → { client, status, qr, phone, presenceTimer, reconnectTimer }
const sessions = new Map()

app.use((req, res, next) => {
  if (API_SECRET && req.headers['x-api-secret'] !== API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
})

async function forwardWebhook(payload) {
  try {
    await fetch(`${FASTAPI_URL}/api/wwebjs/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (e) {
    console.error('[Webhook forward error]', e.message)
  }
}

// Typing delay proportional to message length (avg human: ~40 chars/sec)
function humanTypingMs(message) {
  const base = Math.min(message.length * 60, 6000)
  const jitter = Math.floor(Math.random() * 800)
  return Math.max(800, base + jitter)
}

// Simulate human presence: go online briefly every 15-45 minutes
function startPresenceHeartbeat(sessionId) {
  const session = sessions.get(sessionId)
  if (!session) return
  clearInterval(session.presenceTimer)
  session.presenceTimer = setInterval(async () => {
    const s = sessions.get(sessionId)
    if (!s || s.status !== 'connected') return
    try {
      await s.client.sendPresenceAvailable()
      await new Promise(r => setTimeout(r, Math.random() * 5000 + 2000))
      await s.client.sendPresenceUnavailable()
    } catch (_) {}
  }, (Math.random() * 30 + 15) * 60 * 1000)
}

function createClient(sessionId) {
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: sessionId, dataPath: SESSIONS_PATH }),
    puppeteer: {
      puppeteer: puppeteerExtra,
      headless: true,
      ...(process.env.PUPPETEER_EXECUTABLE_PATH
        ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
        : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
      ],
      defaultViewport: { width: 1280, height: 800 },
    },
  })

  const session = { client, status: 'initializing', qr: null, phone: null, presenceTimer: null, reconnectTimer: null, readyWatchdog: null, ackFailStreak: 0, ackDegraded: false }
  sessions.set(sessionId, session)

  client.on('qr', (qr) => {
    session.status = 'need_scan'
    session.qr = qr
    console.log(`[${sessionId}] QR ready`)
  })

  client.on('authenticated', () => {
    session.status = 'authenticated'
    session.qr = null
    clearTimeout(session.reconnectTimer)
    console.log(`[${sessionId}] Authenticated`)

    // "authenticated" doesn't guarantee "ready" ever fires — whatsapp-web.js can
    // silently hang mid-sync (seen in practice when several sessions restore at
    // once and fight over CPU for their own headless Chromium). No disconnect
    // event fires in that case, so nothing else would ever notice or recover.
    // Self-heal: if still not connected after a generous window, recreate this
    // one session — cheaper and less disruptive than restarting the whole service.
    clearTimeout(session.readyWatchdog)
    session.readyWatchdog = setTimeout(() => {
      const s = sessions.get(sessionId)
      if (!s || s.status === 'connected') return
      console.warn(`[${sessionId}] Stuck in "${s.status}" — never reached ready, recreating session`)
      try { s.client.destroy().catch(() => {}) } catch (_) {}
      sessions.delete(sessionId)
      createClient(sessionId)
    }, 90_000)
  })

  client.on('ready', () => {
    clearTimeout(session.readyWatchdog)
    session.status = 'connected'
    session.qr = null
    session.phone = client.info?.wid?.user || null
    console.log(`[${sessionId}] Ready | phone=${session.phone}`)
    startPresenceHeartbeat(sessionId)
    forwardWebhook({ event: 'session.status', sessionId, data: { status: 'connected', phone: session.phone } })
  })

  client.on('auth_failure', (msg) => {
    clearTimeout(session.readyWatchdog)
    session.status = 'auth_failure'
    clearInterval(session.presenceTimer)
    console.error(`[${sessionId}] Auth failure:`, msg)
    forwardWebhook({ event: 'session.status', sessionId, data: { status: 'auth_failure' } })
  })

  client.on('disconnected', (reason) => {
    clearTimeout(session.readyWatchdog)
    clearInterval(session.presenceTimer)

    // Reasons that mean credentials are gone — need a new QR scan, NOT a reconnect
    const needsReauth = ['LOGOUT', 'UNPAIRED', 'UNPAIRED_IDLE', 'TOS_BLOCK', 'SMB_TOS_BLOCK'].includes(reason)

    if (needsReauth) {
      session.status = 'need_scan'
      session.qr = null
      console.log(`[${sessionId}] Logged out (${reason}) — needs QR re-scan`)
      forwardWebhook({ event: 'session.status', sessionId, data: { status: 'need_scan', reason } })
      // Destroy the browser so it doesn't consume RAM sitting idle
      try { session.client.destroy().catch(() => {}) } catch (_) {}
      return
    }

    // Network/conflict disconnects — safe to auto-reconnect
    session.status = 'disconnected'
    session.qr = null
    console.log(`[${sessionId}] Disconnected (${reason}) — reconnecting...`)
    forwardWebhook({ event: 'session.status', sessionId, data: { status: 'disconnected', reason } })

    const delay = Math.floor(Math.random() * 7000) + 8000
    console.log(`[${sessionId}] Reconnecting in ${Math.round(delay / 1000)}s`)
    session.reconnectTimer = setTimeout(() => {
      const s = sessions.get(sessionId)
      if (!s || s.status === 'connected') return
      console.log(`[${sessionId}] Auto-reconnecting...`)
      try { s.client.destroy().catch(() => {}) } catch (_) {}
      sessions.delete(sessionId)
      createClient(sessionId)
    }, delay)
  })

  client.on('message', async (msg) => {
    if (msg.fromMe) return
    let number = msg.from.replace('@s.whatsapp.net', '').replace('@c.us', '').replace('@lid', '')
    // @lid JIDs are Linked Device IDs (not real phone numbers) — resolve to the
    // actual contact number so the backend can match it to a known company.
    if (msg.from.includes('@lid')) {
      try {
        const contact = await msg.getContact()
        // contact.number returns the LID — contact.id.user is the real phone number
        if (contact.id?.user) number = contact.id.user
      } catch (_) {}
    }
    console.log(`[${sessionId}] ← ${number}: ${String(msg.body).substring(0, 60)}`)
    forwardWebhook({
      event: 'messages.received',
      sessionId,
      data: {
        from: msg.from,
        to: msg.to,
        fromMe: false,
        number,
        body: msg.body,
        type: msg.type,
        messageId: msg.id._serialized,
        timestamp: msg.timestamp,
        hasMedia: msg.hasMedia,
      },
    })
  })

  client.on('message_ack', (msg, ack) => {
    const number = (msg.to || '').replace('@s.whatsapp.net', '').replace('@c.us', '').replace('@lid', '')
    const ackLabel = ['', 'sent', 'delivered', 'read', 'played'][ack] || ack
    console.log(`[${sessionId}] ack ${ackLabel}(${ack}) → ${number}`)

    const s = sessions.get(sessionId)
    if (s) {
      if (ack >= 2) {
        // Delivered or read — reset streak and clear degraded flag
        s.ackFailStreak = 0
        if (s.ackDegraded) {
          s.ackDegraded = false
          forwardWebhook({ event: 'message_ack', sessionId, data: { messageId: msg.id._serialized, ack, to: msg.to, number } })
        }
      } else if (ack === 1) {
        s.ackFailStreak = (s.ackFailStreak || 0) + 1
        if (s.ackFailStreak >= 5 && !s.ackDegraded) {
          s.ackDegraded = true
          console.warn(`[${sessionId}] ACK degraded — ${s.ackFailStreak} consecutive undelivered messages`)
          forwardWebhook({ event: 'session.degraded', sessionId, data: { ackFailStreak: s.ackFailStreak } })
        }
      }
    }

    forwardWebhook({ event: 'message_ack', sessionId, data: { messageId: msg.id._serialized, ack, to: msg.to, number } })
  })

  client.initialize().catch((e) => {
    console.error(`[${sessionId}] Initialize error:`, e.message)
    session.status = 'error'
  })

  return session
}

// Auto-restore sessions from disk on startup
// Cada createClient() lanza su propio Chromium headless — arrancarlas todas
// de golpe (como era antes) las hace competir por CPU/memoria, y la que pierde
// esa carrera se puede quedar atorada en "authenticated" sin llegar nunca a
// "ready" (visto en la práctica). Espaciar el arranque evita esa competencia.
function autoRestoreSessions() {
  if (!fs.existsSync(SESSIONS_PATH)) return
  const dirs = fs.readdirSync(SESSIONS_PATH).filter(d => d.startsWith('session-'))
  dirs.forEach((dir, i) => {
    const sessionId = dir.replace('session-', '')
    setTimeout(() => {
      console.log(`[startup] Restoring session: ${sessionId}`)
      createClient(sessionId)
    }, i * 8000)
  })
}

// ─── Routes ────────────────────────────────────────────────────────────────

app.post('/session/:id/start', (req, res) => {
  const { id } = req.params
  if (sessions.has(id)) {
    const s = sessions.get(id)
    return res.json({ status: s.status, phone: s.phone })
  }
  const session = createClient(id)
  res.json({ status: session.status })
})

app.get('/session/:id/qr', async (req, res) => {
  const { id } = req.params
  const session = sessions.get(id)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  if (!session.qr) return res.status(400).json({ error: 'No QR available', status: session.status })
  try {
    const qrImage = await QRCode.toDataURL(session.qr)
    res.json({ qr: qrImage, status: session.status })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/session/:id/status', (req, res) => {
  const { id } = req.params
  const session = sessions.get(id)
  if (!session) return res.json({ status: 'not_found' })
  res.json({ status: session.status, phone: session.phone })
})

app.post('/session/:id/send', async (req, res) => {
  const { id } = req.params
  const session = sessions.get(id)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  if (session.status !== 'connected') return res.status(400).json({ error: `Not connected: ${session.status}` })

  const { to, message, typingMs, saveContact, contactFirstName, contactLastName } = req.body
  if (!to || !message) return res.status(400).json({ error: 'to and message required' })

  const digits = to.replace(/\D/g, '')

  try {
    // Idle gap: wait until at least 8-30s have passed since last send (anti-ban)
    const minGap = 8000 + Math.floor(Math.random() * 22000)  // 8-30s random
    const elapsed = Date.now() - (session.lastSendAt || 0)
    if (elapsed < minGap) {
      const wait = minGap - elapsed
      console.log(`[${id}] idle gap ${wait}ms before next send`)
      await new Promise(r => setTimeout(r, wait))
    }

    // Optionally save contact to addressbook before first message (looks human)
    if (saveContact && contactFirstName) {
      try {
        await session.client.saveOrEditAddressbookContact(digits, contactFirstName, contactLastName || '')
        console.log(`[${id}] contact saved: ${digits} → ${contactFirstName}`)
      } catch (_) {}
    }

    const numberId = await session.client.getNumberId(digits).catch(() => null)
    if (!numberId) return res.status(400).json({ error: `Number ${digits} not found on WhatsApp` })

    // Human-like typing delay
    const delay = typingMs !== undefined ? typingMs : humanTypingMs(message)
    if (delay > 0) {
      try {
        const chat = await session.client.getChatById(numberId._serialized)
        await chat.sendStateTyping()
        await new Promise(r => setTimeout(r, delay))
        await chat.clearState()
      } catch (_) {}
    }

    const msg = await session.client.sendMessage(numberId._serialized, message)
    session.lastSendAt = Date.now()
    console.log(`[${id}] → ${digits} (${message.length} chars, ${delay}ms typing, gap=${elapsed}ms)`)
    res.json({ success: true, messageId: msg?.id?._serialized })
  } catch (e) {
    console.error(`[${id}] send error:`, e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/session/:id/send-media', async (req, res) => {
  const { id } = req.params
  const session = sessions.get(id)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  if (session.status !== 'connected') return res.status(400).json({ error: `Not connected: ${session.status}` })

  const { to, mediaUrl, filename, caption, typingMs } = req.body
  if (!to || !mediaUrl) return res.status(400).json({ error: 'to and mediaUrl required' })

  const digits = to.replace(/\D/g, '')

  try {
    // Idle gap — same anti-ban logic as text sends
    const minGap = 8000 + Math.floor(Math.random() * 22000)
    const elapsed = Date.now() - (session.lastSendAt || 0)
    if (elapsed < minGap) {
      const wait = minGap - elapsed
      console.log(`[${id}] idle gap ${wait}ms before media send`)
      await new Promise(r => setTimeout(r, wait))
    }

    const numberId = await session.client.getNumberId(digits)
    if (!numberId) return res.status(400).json({ error: 'Number not on WhatsApp', phone: digits })

    // Typing simulation
    const delay = typingMs || humanTypingMs(caption || filename || 'media')
    if (delay > 0) {
      try {
        const chat = await session.client.getChatById(numberId._serialized)
        await chat.sendStateTyping()
        await new Promise(r => setTimeout(r, delay))
        await chat.clearState()
      } catch (_) {}
    }

    const media = await MessageMedia.fromUrl(mediaUrl, { unsafeMime: true })
    if (filename) media.filename = filename

    const msg = await session.client.sendMessage(numberId._serialized, media, {
      caption: caption || '',
      sendMediaAsDocument: !media.mimetype.startsWith('image/'),
    })
    session.lastSendAt = Date.now()

    console.log(`[${id}] ✓ media sent → ${digits} (${media.mimetype}) ${filename || ''}`)
    res.json({ success: true, messageId: msg.id._serialized, phone: digits, mimetype: media.mimetype })
  } catch (e) {
    console.error(`[${id}] send-media error:`, e.message)
    res.status(500).json({ error: e.message })
  }
})

app.post('/session/:id/typing', async (req, res) => {
  const { id } = req.params
  const session = sessions.get(id)
  if (!session || session.status !== 'connected') return res.status(400).json({ error: 'Not connected' })

  const { to } = req.body
  if (!to) return res.status(400).json({ error: 'to required' })

  try {
    const numberId = await session.client.getNumberId(to.replace(/\D/g, '')).catch(() => null)
    const chatId = numberId?._serialized || `${to.replace(/\D/g, '')}@s.whatsapp.net`
    const chat = await session.client.getChatById(chatId)
    await chat.sendStateTyping()
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/session/:id/read', async (req, res) => {
  const { id } = req.params
  const session = sessions.get(id)
  if (!session || session.status !== 'connected') return res.status(400).json({ error: 'Not connected' })

  const { to } = req.body
  if (!to) return res.status(400).json({ error: 'to required' })

  try {
    // Human delay before marking as read (0.5-2s)
    await new Promise(r => setTimeout(r, Math.random() * 1500 + 500))
    const numberId = await session.client.getNumberId(to.replace(/\D/g, '')).catch(() => null)
    const chatId = numberId?._serialized || `${to.replace(/\D/g, '')}@s.whatsapp.net`
    await session.client.sendSeen(chatId)
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Verify if a phone number is registered on WhatsApp
app.post('/session/:id/verify', async (req, res) => {
  const { id } = req.params
  const session = sessions.get(id)
  if (!session || session.status !== 'connected') return res.status(400).json({ error: 'Not connected' })
  const { phone } = req.body
  if (!phone) return res.status(400).json({ error: 'phone required' })
  try {
    const digits = phone.replace(/\D/g, '')
    const isRegistered = await session.client.isRegisteredUser(`${digits}@c.us`)
    const numberId = isRegistered ? await session.client.getNumberId(digits).catch(() => null) : null
    res.json({ registered: isRegistered, chatId: numberId?._serialized || null, phone: digits })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Save a contact to the addressbook
app.post('/session/:id/contact/save', async (req, res) => {
  const { id } = req.params
  const session = sessions.get(id)
  if (!session || session.status !== 'connected') return res.status(400).json({ error: 'Not connected' })
  const { phone, firstName, lastName } = req.body
  if (!phone || !firstName) return res.status(400).json({ error: 'phone and firstName required' })
  try {
    await session.client.saveOrEditAddressbookContact(phone.replace(/\D/g, ''), firstName, lastName || '')
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Get session info (phone, pushname, platform)
app.get('/session/:id/info', (req, res) => {
  const { id } = req.params
  const session = sessions.get(id)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  if (session.status !== 'connected') return res.json({ status: session.status, phone: session.phone })
  const info = session.client.info
  res.json({
    status: session.status,
    phone: session.phone,
    pushname: info?.pushname,
    platform: info?.platform,
    wid: info?.wid?._serialized,
  })
})

// Set profile status/about text
app.post('/session/:id/profile/status', async (req, res) => {
  const { id } = req.params
  const session = sessions.get(id)
  if (!session || session.status !== 'connected') return res.status(400).json({ error: 'Not connected' })
  const { status } = req.body
  if (typeof status !== 'string') return res.status(400).json({ error: 'status string required' })
  try {
    await session.client.setStatus(status)
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// React to a received message
app.post('/session/:id/react', async (req, res) => {
  const { id } = req.params
  const session = sessions.get(id)
  if (!session || session.status !== 'connected') return res.status(400).json({ error: 'Not connected' })
  const { messageId, emoji } = req.body
  if (!messageId || !emoji) return res.status(400).json({ error: 'messageId and emoji required' })
  try {
    await session.client.sendReaction(messageId, emoji)
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.delete('/session/:id', async (req, res) => {
  const { id } = req.params
  const session = sessions.get(id)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  clearInterval(session.presenceTimer)
  clearTimeout(session.reconnectTimer)
  try { await session.client.destroy() } catch (_) {}
  sessions.delete(id)
  res.json({ success: true })
})

app.get('/sessions', (req, res) => {
  const result = {}
  for (const [id, s] of sessions) {
    result[id] = { status: s.status, phone: s.phone }
  }
  res.json(result)
})

app.get('/health', (_req, res) => res.json({ ok: true, sessions: sessions.size }))

app.listen(PORT, () => {
  console.log(`wwebjs-service on port ${PORT}`)
  autoRestoreSessions()
})
