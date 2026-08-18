const express = require('express')
const { Client, LocalAuth } = require('whatsapp-web.js')
const QRCode = require('qrcode')

const app = express()
app.use(express.json({ limit: '10mb' }))

const PORT = process.env.PORT || 3001
const FASTAPI_URL = process.env.FASTAPI_URL || 'http://backend:8000'
const API_SECRET = process.env.API_SECRET || ''
const SESSIONS_PATH = process.env.SESSIONS_PATH || '/app/sessions'

// sessionId → { client, status, qr, phone }
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

function createClient(sessionId) {
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: sessionId, dataPath: SESSIONS_PATH }),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--single-process',
      ],
    },
  })

  const session = { client, status: 'initializing', qr: null, phone: null }
  sessions.set(sessionId, session)

  client.on('qr', (qr) => {
    session.status = 'need_scan'
    session.qr = qr
    console.log(`[${sessionId}] QR ready`)
  })

  client.on('authenticated', () => {
    session.status = 'authenticated'
    session.qr = null
    console.log(`[${sessionId}] Authenticated`)
  })

  client.on('ready', () => {
    session.status = 'connected'
    session.qr = null
    session.phone = client.info?.wid?.user || null
    console.log(`[${sessionId}] Ready | phone=${session.phone}`)
    forwardWebhook({ event: 'session.status', sessionId, data: { status: 'connected', phone: session.phone } })
  })

  client.on('auth_failure', (msg) => {
    session.status = 'auth_failure'
    console.error(`[${sessionId}] Auth failure:`, msg)
    forwardWebhook({ event: 'session.status', sessionId, data: { status: 'auth_failure' } })
  })

  client.on('disconnected', (reason) => {
    session.status = 'disconnected'
    console.log(`[${sessionId}] Disconnected:`, reason)
    forwardWebhook({ event: 'session.status', sessionId, data: { status: 'disconnected', reason } })
  })

  client.on('message', async (msg) => {
    if (msg.fromMe) return
    const number = msg.from.replace('@s.whatsapp.net', '').replace('@c.us', '')
    console.log(`[${sessionId}] Message from ${number}: ${String(msg.body).substring(0, 60)}`)
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
    forwardWebhook({
      event: 'message_ack',
      sessionId,
      data: { messageId: msg.id._serialized, ack, to: msg.to },
    })
  })

  client.initialize().catch((e) => {
    console.error(`[${sessionId}] Initialize error:`, e.message)
    session.status = 'error'
  })

  return session
}

// Start or restore session
app.post('/session/:id/start', (req, res) => {
  const { id } = req.params
  if (sessions.has(id)) {
    const s = sessions.get(id)
    return res.json({ status: s.status, phone: s.phone })
  }
  const session = createClient(id)
  res.json({ status: session.status })
})

// Get QR as base64 image
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

// Get session status
app.get('/session/:id/status', (req, res) => {
  const { id } = req.params
  const session = sessions.get(id)
  if (!session) return res.json({ status: 'not_found' })
  res.json({ status: session.status, phone: session.phone })
})

// Send message
app.post('/session/:id/send', async (req, res) => {
  const { id } = req.params
  const session = sessions.get(id)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  if (session.status !== 'connected') return res.status(400).json({ error: `Not connected: ${session.status}` })

  const { to, message, typingMs } = req.body
  if (!to || !message) return res.status(400).json({ error: 'to and message required' })

  const chatId = to.includes('@') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`

  try {
    if (typingMs && typingMs > 0) {
      const chat = await session.client.getChatById(chatId)
      await chat.sendStateTyping()
      await new Promise((r) => setTimeout(r, typingMs))
      await chat.clearState()
    }
    const msg = await session.client.sendMessage(chatId, message)
    res.json({ success: true, messageId: msg.id._serialized })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Typing indicator (fire and forget)
app.post('/session/:id/typing', async (req, res) => {
  const { id } = req.params
  const session = sessions.get(id)
  if (!session || session.status !== 'connected') return res.status(400).json({ error: 'Not connected' })

  const { to } = req.body
  if (!to) return res.status(400).json({ error: 'to required' })
  const chatId = to.includes('@') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`

  try {
    const chat = await session.client.getChatById(chatId)
    await chat.sendStateTyping()
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Mark as read
app.post('/session/:id/read', async (req, res) => {
  const { id } = req.params
  const session = sessions.get(id)
  if (!session || session.status !== 'connected') return res.status(400).json({ error: 'Not connected' })

  const { to } = req.body
  if (!to) return res.status(400).json({ error: 'to required' })
  const chatId = to.includes('@') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`

  try {
    await session.client.sendSeen(chatId)
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Logout and delete session
app.delete('/session/:id', async (req, res) => {
  const { id } = req.params
  const session = sessions.get(id)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  try {
    await session.client.destroy()
  } catch (e) {
    console.error(`[${id}] Destroy error:`, e.message)
  }
  sessions.delete(id)
  res.json({ success: true })
})

// List all sessions
app.get('/sessions', (req, res) => {
  const result = {}
  for (const [id, s] of sessions) {
    result[id] = { status: s.status, phone: s.phone }
  }
  res.json(result)
})

app.get('/health', (_req, res) => res.json({ ok: true, sessions: sessions.size }))

app.listen(PORT, () => console.log(`wwebjs-service on port ${PORT}`))
