const express = require('express')
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js')
const puppeteerExtra = require('puppeteer-extra')
const StealthPlugin  = require('puppeteer-extra-plugin-stealth')
const QRCode = require('qrcode')
const fs = require('fs')
const path = require('path')

puppeteerExtra.use(StealthPlugin())

const app = express()
app.use(express.json({ limit: '10mb' }))

const PORT         = process.env.PORT         || 3001
const FASTAPI_URL  = process.env.FASTAPI_URL  || 'http://backend:8000'
const API_SECRET   = process.env.API_SECRET   || ''
const SESSIONS_PATH = process.env.SESSIONS_PATH || '/app/sessions'

// Residential proxy for WhatsApp's outbound connection — every session
// shares this one exit IP instead of Hostinger's own datacenter IP. A
// datacenter IP is a known detection signal on its own; a shared residential
// IP still means every session falls together if THIS one gets flagged, but
// it's the cheaper starting point the team chose over one dedicated IP per
// session (see README's "por qué el outbound masivo no es viable" section —
// same tradeoff already documented there for the old WAHA/Wasender setup).
// PROXY_SERVER expects host:port (e.g. "gate.smartproxy.com:7000") — no
// scheme prefix, matching Chromium's --proxy-server flag directly.
const PROXY_SERVER   = process.env.PROXY_SERVER   || ''
const PROXY_USERNAME = process.env.PROXY_USERNAME || ''
const PROXY_PASSWORD = process.env.PROXY_PASSWORD || ''

// sessionId → { client, status, qr, phone, presenceTimer, reconnectTimer }
const sessions = new Map()

// A single flaky Chromium target (protocol timeout, "Execution context was
// destroyed", etc. — routine when several sessions boot concurrently and
// compete for CPU) can throw from deep inside whatsapp-web.js/puppeteer on a
// code path that ISN'T part of the promise client.initialize().catch(...)
// already guards below — Node then treats it as an uncaught exception /
// unhandled rejection and kills the WHOLE process, taking down every other
// already-connected session with it. Observed live: gely-test2/tania-* sessions
// timing out during startup crashed sender4/sender666 mid-conversation.
// Logging and continuing is far safer than letting one bad target restart
// everything.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.message, err && err.stack)
})
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})

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

// Catch a name/photo change made OUTSIDE this app (straight from the phone).
// whatsapp-web.js exposes no real-time event for it — `contact_changed` only
// fires for a phone NUMBER change, not name/photo. The WhatsApp Web page
// itself DOES receive this live over multi-device sync (that's why the name
// updates on screen if you have Web open when you rename yourself from the
// phone), but the library never wires a public event to it, and hooking the
// same fragile internal module used for the write side (see
// ensureProfileModuleLoaded) isn't worth it just to read a value — so poll
// instead: every 30min, compare against what we last saw and only forward a
// webhook when something actually changed.
function startProfileSyncPoll(sessionId) {
  const session = sessions.get(sessionId)
  if (!session) return
  clearInterval(session.profileSyncTimer)
  session.profileSyncTimer = setInterval(async () => {
    const s = sessions.get(sessionId)
    if (!s || s.status !== 'connected') return
    try {
      const pushname = s.client.info?.pushname || null
      const profilePicUrl = await fetchProfilePicUrl(s.client, sessionId)
      const changed = pushname !== s.lastPushname || (profilePicUrl && profilePicUrl !== s.lastProfilePicUrl)
      if (changed) {
        console.log(`[${sessionId}] profile change detected outside the app — syncing`)
        s.lastPushname = pushname
        if (profilePicUrl) s.lastProfilePicUrl = profilePicUrl
        forwardWebhook({ event: 'profile.updated', sessionId, data: { pushname, profile_pic_url: profilePicUrl } })
      }
    } catch (_) {}
  }, 30 * 60 * 1000)
}

// Some whatsapp-web.js sessions go "zombie": the client stays marked
// connected and no 'disconnected' event ever fires, but the underlying page
// has silently died (frame detached) and stops sending/receiving for good —
// a widely-reported, unresolved upstream issue (wwebjs/whatsapp-web.js
// #127105). Nothing in our own event handlers can catch this since it's
// exactly the class of failure that skips those events. Poll getState()
// periodically instead — a real reply proves the session is alive; a
// timeout or thrown error is the only signal a zombie session gives at all.
// One bad poll is tolerated (a single slow CDP round-trip under host
// contention, same as elsewhere in this file) — two in a row triggers the
// same destroy-and-recreate recovery already used by readyWatchdog/reconnect.
function startLivenessHeartbeat(sessionId) {
  const session = sessions.get(sessionId)
  if (!session) return
  clearInterval(session.heartbeatTimer)
  session.heartbeatFailStreak = 0
  session.heartbeatTimer = setInterval(async () => {
    const s = sessions.get(sessionId)
    if (!s || s.status !== 'connected') return
    try {
      await Promise.race([
        s.client.getState(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('getState() timed out')), 10000)),
      ])
      s.heartbeatFailStreak = 0
    } catch (e) {
      s.heartbeatFailStreak = (s.heartbeatFailStreak || 0) + 1
      console.warn(`[${sessionId}] Heartbeat failed (${s.heartbeatFailStreak}/2): ${e.message}`)
      if (s.heartbeatFailStreak < 2) return
      console.warn(`[${sessionId}] Session looks zombie (no live disconnect event) — recreating`)
      clearInterval(s.heartbeatTimer)
      clearInterval(s.presenceTimer)
      clearInterval(s.profileSyncTimer)
      forwardWebhook({ event: 'session.status', sessionId, data: { status: 'disconnected', reason: 'HEARTBEAT_TIMEOUT' } })
      await destroySessionClient(s.client, sessionId, s.initPromise)
      sessions.delete(sessionId)
      createClient(sessionId, s.phoneNumber)
    }
  }, (Math.random() * 5 + 15) * 1000)
}

// client.getProfilePicUrl() (whatsapp-web.js/src/Client.js) resolves a Chat via
// WWebJS.getChat(contactId) BEFORE it ever asks the server for the picture —
// and there is normally no chat thread with your own number (WhatsApp only
// creates one if "Message Yourself" has been used at least once), so getChat()
// throws for the exact contactId this function is always called with. That's
// the whole bug (github.com/wwebjs/whatsapp-web.js issues #1277/#3005): the
// profile-pic bridge itself never receives anything, so no reachability/CDN
// issue would explain the failure — it's a resolution failure one step earlier.
// Workaround, UNTESTED against a live session (no session available in dev to
// verify against): skip getChat() entirely and hand the profile-pic bridge a
// bare `{ id: wid }` built straight from WAWebWidFactory — requestProfilePicFromServer
// only needs `.id` off whatever it's given, a Chat model is just the caller's
// convention, not a hard requirement enforced by the bridge itself (per its
// signature; unverified live). Falls back to the original (broken-for-self)
// call if this throws or returns nothing, so behavior can only get better, never worse.
// Both paths below fail intermittently (not permanently) with terse, unhelpful
// errors — confirmed live: the same session succeeds on one poll and fails
// with "failed: r" on the next with nothing else changed. That "r" is a
// minified WhatsApp Web internal identifier losing its real message crossing
// the Puppeteer evaluate() boundary, not a real diagnostic. Since retrying
// the SAME poll a couple of times resolves it most of the time, do that
// before giving up for this tick — cheap, and turns "occasionally misses a
// real change" into "very rarely misses one".
const _PROFILE_PIC_RETRIES = 2
const _PROFILE_PIC_RETRY_DELAY_MS = 1500

async function fetchProfilePicUrl(client, sessionId) {
  for (let attempt = 0; attempt <= _PROFILE_PIC_RETRIES; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, _PROFILE_PIC_RETRY_DELAY_MS))
    try {
      const ownId = client.info?.wid?._serialized
      if (ownId) {
        try {
          const url = await client.pupPage.evaluate(async (contactId) => {
            const wid = window.require('WAWebWidFactory').createWid(contactId)
            const profilePic = await window
              .require('WAWebContactProfilePicThumbBridge')
              .requestProfilePicFromServer({ id: wid })
            return profilePic ? profilePic.eurl : null
          }, ownId)
          if (url) {
            console.log(`[${sessionId}] getProfilePicUrl (direct-wid workaround) -> ok (${url.length} chars)${attempt > 0 ? ` [retry ${attempt}]` : ''}`)
            return url
          }
          console.log(`[${sessionId}] getProfilePicUrl (direct-wid workaround) -> empty/null, falling back`)
        } catch (workaroundErr) {
          console.log(`[${sessionId}] getProfilePicUrl (direct-wid workaround) failed: ${workaroundErr.message} — falling back`)
        }
      }
      const url = await client.getProfilePicUrl(client.info.wid._serialized)
      console.log(`[${sessionId}] getProfilePicUrl -> ${url ? 'ok (' + url.length + ' chars)' : 'empty/null'}${attempt > 0 ? ` [retry ${attempt}]` : ''}`)
      if (url) return url
    } catch (e) {
      console.log(`[${sessionId}] getProfilePicUrl failed: ${e.message}`)
    }
  }
  return null
}

// client.destroy() (whatsapp-web.js) only does `await browser.close()` — a
// graceful CDP request with no timeout and no verification that the
// underlying OS Chrome process actually exited. Under host contention
// (several sessions competing for CPU/Puppeteer) that close can hang or
// silently fail, leaving an ORPHANED Chrome process still holding the
// session's userDataDir — the next createClient() for that same session then
// fails with "The browser is already running for .../userDataDir" or
// "Target closed", and since the orphan was never added back to `sessions`,
// nothing in our own bookkeeping even knows it's there to retry cleaning up
// (confirmed live 2026-09-17: gely-test2 stuck exactly like this, only fixed
// by manually `pkill -9 -f user-data-dir=...` over SSH). This wraps
// destroy() with a hard timeout and a fallback SIGKILL on the actual OS
// process, so every teardown site (DELETE, /start's recreate, the idle
// sweep) reliably frees the profile directory instead of sometimes leaving
// a zombie behind for the next attempt to trip over.
// A container-boot restore isn't the only way a session's Chromium profile
// can end up with a stale SingletonLock/-Cookie/-Socket — a force-killed
// process (SIGKILL, right below) skips its own cleanup entirely and leaves
// the same files behind mid-runtime. Any code recreating a session right
// after tearing the old one down needs this, not just the boot path.
function clearSessionLockFiles(sessionId) {
  const dir = path.join(SESSIONS_PATH, `session-${sessionId}`)
  for (const lockFile of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try { fs.rmSync(path.join(dir, lockFile), { force: true }) } catch (_) {}
  }
}

async function destroySessionClient(client, sessionId, initPromise) {
  // A client whose initialize() launch is still in flight has no pupBrowser
  // yet — grabbing `proc` before waiting misses the process entirely, the
  // launch finishes moments later on its own (orphaned), and claims the
  // profile's lock right out from under the NEXT createClient() for this
  // same session. Confirmed live 2026-09-22 under rapid QR<->pairing-code
  // switching: destroy() had nothing to kill, then a session recreated
  // immediately after hit "browser is already running" once the orphaned
  // launch caught up. initPromise already swallows its own rejection inside
  // createClient(), so this race never rejects — it just bounds the wait.
  if (initPromise) await Promise.race([initPromise, new Promise(r => setTimeout(r, 5000))])
  const proc = client.pupBrowser?.process ? client.pupBrowser.process() : null
  try {
    await Promise.race([
      client.destroy(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('destroy() timed out')), 8000)),
    ])
  } catch (e) {
    console.log(`[${sessionId}] destroy() didn't finish cleanly (${e.message}) — checking for a leftover process`)
  }
  if (proc && proc.exitCode === null && !proc.killed) {
    console.log(`[${sessionId}] Chrome process ${proc.pid} still alive after destroy() — force-killing it`)
    try { proc.kill('SIGKILL') } catch (_) {}
  }
  // Confirmed live 2026-09-22: rapid QR<->pairing-code switching hit "The
  // browser is already running for .../userDataDir" on the very next
  // createClient() — a SIGKILL'd Chromium never runs the exit handler that
  // normally removes its own lock, so it was still sitting there.
  clearSessionLockFiles(sessionId)
}

// Upstream whatsapp-web.js bug (github.com/wwebjs/whatsapp-web.js#201921,
// fixed upstream in PR #201923 but not yet in the 1.34.7 release this project
// pins): MessageMedia carries an internal `__x_id` property that collides
// with the outgoing Msg model's own id field once spread into it, making
// getValidatedSender() resolve against the wrong id and throw "Data passed
// to getter must include an id property" — every media send failed with
// this, confirmed live 2026-09-21 (100% reproducible, any session, any
// media type). Stripping it before the media object is used is the same
// workaround the upstream fix applies.
function stripMediaCollisionId(media) {
  delete media.__x_id
  return media
}

function createClient(sessionId, phoneNumber) {
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: sessionId, dataPath: SESSIONS_PATH }),
    // Pairing-code linking instead of QR: whatsapp-web.js's initialize() branches on
    // this option internally — when phoneNumber is set it never emits 'qr' at all,
    // only 'code' (see requestPairingCode in the library). Default intervalMs (3min)
    // gives a much wider window than a QR frame (~20s), useful when the phone being
    // linked isn't in the same room as whoever's running this.
    ...(phoneNumber ? { pairWithPhoneNumber: { phoneNumber, showNotification: true } } : {}),
    // Only whatsapp-web.js's own traffic needs the proxy credentials — the
    // --proxy-server Chromium flag below routes the connection, this just
    // answers the proxy's auth challenge for it (Basic auth doesn't work via
    // the URL for Chromium's own requests, per Puppeteer's documented proxy
    // auth pattern).
    ...(PROXY_SERVER && PROXY_USERNAME
      ? { proxyAuthentication: { username: PROXY_USERNAME, password: PROXY_PASSWORD } }
      : {}),
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
        // Memory-reduction flags added 2026-09-18 after a host-wide Docker daemon
        // freeze (dozens of unrelated containers hit simultaneous health-check
        // timeouts/exec failures) that correlated with 6 concurrent Chrome
        // instances on a server with 0 swap and ~1.4GB RAM headroom. These trim
        // per-session overhead without touching shared server config (swap,
        // daemon.json) — that's a separate, deliberately-deferred conversation.
        '--disable-breakpad',           // one fewer crashpad_handler child process per session
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-domain-reliability',
        '--disable-hang-monitor',
        '--disable-sync',
        '--metrics-recording-only',
        '--mute-audio',
        '--js-flags=--max-old-space-size=256',
        ...(PROXY_SERVER ? [`--proxy-server=${PROXY_SERVER}`] : []),
      ],
      defaultViewport: { width: 1280, height: 800 },
    },
  })

  // lastPolledAt: bumped by /status, /qr and /pairing-code whenever this
  // session is awaiting a scan/code — lets sweepIdleReconnectSessions() below
  // tell "someone has the reconnect dialog open" from "nobody's watching, stop
  // burning CPU generating QR/codes forever" (see that function's own comment
  // for the real incident this fixes).
  const session = { client, status: 'initializing', qr: null, pairingCode: null, phoneNumber, phone: null, presenceTimer: null, reconnectTimer: null, readyWatchdog: null, ackFailStreak: 0, ackDegraded: false, profileSyncTimer: null, heartbeatTimer: null, heartbeatFailStreak: 0, initPromise: null, lastPushname: null, lastProfilePicUrl: null, lastPolledAt: Date.now() }
  sessions.set(sessionId, session)

  client.on('qr', (qr) => {
    // Only notify the backend on the actual TRANSITION into need_scan, not on
    // every QR refresh while a dialog is already open — otherwise this fires
    // repeatedly (QR regenerates every ~20s while unscanned) for no benefit.
    // Without this webhook at all, a session that gets logged out and comes
    // back needing a fresh scan at boot never told the backend, so its DB
    // record stayed on whatever it last was (real case, 2026-09-21:
    // tania-sesion-1/tania-sesion-3 kept showing "Sesión activa" in the
    // Instances panel after a real WhatsApp-side logout, since only the
    // disconnected-event webhook existed, and that one is what a stale
    // duplicate 'ready' event was already racing and overwriting — see the
    // guard added in the 'ready' handler above).
    if (session.status !== 'need_scan') forwardWebhook({ event: 'session.status', sessionId, data: { status: 'need_scan' } })
    session.status = 'need_scan'
    session.qr = qr
    console.log(`[${sessionId}] QR ready`)
  })

  client.on('code', (code) => {
    if (session.status !== 'need_scan') forwardWebhook({ event: 'session.status', sessionId, data: { status: 'need_scan' } })
    session.status = 'need_scan'
    session.pairingCode = code
    console.log(`[${sessionId}] Pairing code ready: ${code}`)
  })

  client.on('authenticated', () => {
    session.status = 'authenticated'
    session.qr = null; session.pairingCode = null
    clearTimeout(session.reconnectTimer)
    console.log(`[${sessionId}] Authenticated`)

    // "authenticated" doesn't guarantee "ready" ever fires — whatsapp-web.js can
    // silently hang mid-sync (seen in practice when several sessions restore at
    // once and fight over CPU for their own headless Chromium). No disconnect
    // event fires in that case, so nothing else would ever notice or recover.
    // Self-heal: if still not connected after a generous window, recreate this
    // one session — cheaper and less disruptive than restarting the whole service.
    clearTimeout(session.readyWatchdog)
    session.readyWatchdog = setTimeout(async () => {
      const s = sessions.get(sessionId)
      if (!s || s.status === 'connected') return
      console.warn(`[${sessionId}] Stuck in "${s.status}" — never reached ready, recreating session`)
      await destroySessionClient(s.client, sessionId, s.initPromise)
      sessions.delete(sessionId)
      createClient(sessionId, session.phoneNumber)
    }, 90_000)
  })

  client.on('ready', async () => {
    clearTimeout(session.readyWatchdog)
    // whatsapp-web.js's own "ready" event can fire a beat before its internal
    // comms channel (startComms) has actually finished initializing — under
    // host contention (several sessions competing for the same Puppeteer/CDP
    // resources) that window widens enough for an immediate API call
    // (getProfilePicUrl, sendMessage, getNumberId — anything using sendIq
    // under the hood) to hit "[comms] sendIq called before startComms", a
    // known whatsapp-web.js issue that recurs across versions/years
    // (github.com/pedroslopez/whatsapp-web.js issues #3804, #1037) — not
    // something wrong in our own code. A short settle delay here, before
    // marking the session usable for real sends OR making our own first API
    // call (the profile-pic fetch below), gives that window room to close.
    await new Promise(r => setTimeout(r, 2000))
    // A LOGOUT/disconnect can land during the settle delay above — this
    // handler was already in flight from a stale 'ready' fired moments
    // before, and without this guard it blindly overwrites the correct
    // need_scan/disconnected status back to 'connected' seconds later (real
    // case, 2026-09-21: tania-sesion-1 and tania-sesion-3 both showed
    // "Sesión activa" in the Instances panel minutes after WhatsApp had
    // already logged them out — this stale webhook is what overwrote the
    // correct one). Bail out if the client was torn down, or the session
    // moved past 'authenticated' into a disconnect-family state (need_scan/
    // disconnected/auth_failure/error) while we were waiting — 'connected'
    // is also allowed through as a harmless no-op for a genuine duplicate
    // 'ready' firing on an already-healthy session.
    const _liveStatus = sessions.get(sessionId)?.status
    if (sessions.get(sessionId) !== session || (_liveStatus !== 'authenticated' && _liveStatus !== 'connected')) {
      console.log(`[${sessionId}] stale ready event ignored (session status is now ${_liveStatus ?? 'destroyed'})`)
      return
    }
    session.status = 'connected'
    session.qr = null; session.pairingCode = null
    session.phone = client.info?.wid?.user || null
    console.log(`[${sessionId}] Ready | phone=${session.phone}`)
    startPresenceHeartbeat(sessionId)
    startProfileSyncPoll(sessionId)
    startLivenessHeartbeat(sessionId)

    // Profile name + picture, shown in the Instances panel so it's clear who's
    // behind each line — best-effort, never blocks the "connected" webhook.
    const pushname = client.info?.pushname || null
    const profilePicUrl = await fetchProfilePicUrl(client, sessionId)
    session.lastPushname = pushname
    if (profilePicUrl) session.lastProfilePicUrl = profilePicUrl

    forwardWebhook({ event: 'session.status', sessionId, data: { status: 'connected', phone: session.phone, pushname, profile_pic_url: profilePicUrl } })

    // getProfilePicUrl fetching OUR OWN profile pic fails consistently as of
    // 2026-09 — a known, unresolved whatsapp-web.js issue where getChat() can't
    // resolve a "chat" for yourself (see github.com/wwebjs/whatsapp-web.js
    // issues #1277/#3005). Confirmed via 3 immediate retries all failing
    // identically, so this is NOT a cache-warmup race.
    //
    // REMOVED (2026-09-17): this used to retry twice more (4s, 8s later), each
    // retry itself running fetchProfilePicUrl's own 3-attempt loop — up to 12
    // MORE guaranteed-to-fail Puppeteer/CDP evaluate() calls per connection,
    // by this comment's own admission ("not because it currently helps").
    // Confirmed live: with several sessions reconnecting close together
    // (during a redeploy, or several idle sessions restoring at once), all
    // of them firing this cascade at the same time saturates the CDP
    // channel enough to make REAL operations — most importantly actual
    // message sends — hang for 150s+ waiting their turn. startProfileSyncPoll
    // (every 15-45min, in an already-stable connection) still retries
    // fetchProfilePicUrl's internal loop for the cases where that genuinely
    // helps (intermittent failures, not this permanent one); this one-off
    // connection-time attempt no longer piles more guaranteed failures on
    // top of it.
  })

  client.on('auth_failure', (msg) => {
    clearTimeout(session.readyWatchdog)
    session.status = 'auth_failure'
    clearInterval(session.presenceTimer)
    clearInterval(session.profileSyncTimer)
    clearInterval(session.heartbeatTimer)
    console.error(`[${sessionId}] Auth failure:`, msg)
    forwardWebhook({ event: 'session.status', sessionId, data: { status: 'auth_failure' } })
  })

  client.on('disconnected', async (reason) => {
    clearTimeout(session.readyWatchdog)
    clearInterval(session.presenceTimer)
    clearInterval(session.profileSyncTimer)
    clearInterval(session.heartbeatTimer)

    // Reasons that mean credentials are gone — need a new QR scan, NOT a reconnect
    const needsReauth = ['LOGOUT', 'UNPAIRED', 'UNPAIRED_IDLE', 'TOS_BLOCK', 'SMB_TOS_BLOCK'].includes(reason)

    if (needsReauth) {
      session.status = 'need_scan'
      session.qr = null; session.pairingCode = null
      console.log(`[${sessionId}] Logged out (${reason}) — needs QR re-scan`)
      forwardWebhook({ event: 'session.status', sessionId, data: { status: 'need_scan', reason } })
      // Destroy the browser so it doesn't consume RAM sitting idle. Was a bare
      // client.destroy().catch(()=>{}) with no verification the underlying OS
      // Chrome process actually exited — the same gap destroySessionClient()
      // was built to close for the idle-sweep/DELETE/recreate paths, just
      // never wired in here too. Real case, 2026-09-21: tania-sesion-4 got
      // LOGOUT'd, and the very next reconnect attempt failed repeatedly with
      // "The browser is already running for .../userDataDir" — an orphaned
      // Chrome from this exact destroy() call was still holding it.
      await destroySessionClient(session.client, sessionId, session.initPromise)
      return
    }

    // Network/conflict disconnects — safe to auto-reconnect
    session.status = 'disconnected'
    session.qr = null; session.pairingCode = null
    console.log(`[${sessionId}] Disconnected (${reason}) — reconnecting...`)
    forwardWebhook({ event: 'session.status', sessionId, data: { status: 'disconnected', reason } })

    const delay = Math.floor(Math.random() * 7000) + 8000
    console.log(`[${sessionId}] Reconnecting in ${Math.round(delay / 1000)}s`)
    session.reconnectTimer = setTimeout(async () => {
      const s = sessions.get(sessionId)
      if (!s || s.status === 'connected') return
      console.log(`[${sessionId}] Auto-reconnecting...`)
      await destroySessionClient(s.client, sessionId, s.initPromise)
      sessions.delete(sessionId)
      createClient(sessionId, session.phoneNumber)
    }, delay)
  })

  // whatsapp-web.js fires 'message' for protocol-level events too, not just real user
  // text — e.g. 'e2e_notification' (the "encryption session established" system notice
  // WhatsApp injects the first time a chat opens with a number, empty body). Forwarding
  // these created phantom empty-body inbound records every time we contacted a new
  // prospect, which the backend then logged and classified as if a human had replied.
  const NON_CONTENT_MSG_TYPES = new Set([
    'e2e_notification', 'notification_template', 'gp2', 'call_log', 'revoked', 'ciphertext', 'protocol',
  ])

  client.on('message', async (msg) => {
    if (msg.fromMe) return
    if (NON_CONTENT_MSG_TYPES.has(msg.type)) return
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

    // DIAGNOSTIC (temporary): kept alongside the extraction below as a safety
    // net — if the field paths guessed from whatsapp-web.js's own OUTGOING
    // list-message code (Injected/Utils.js) turn out wrong for an INCOMING
    // one, this still captures the real shape to fix it properly. Remove once
    // the extraction below has been confirmed against a real example.
    if (msg.type === 'list' || msg.type === 'buttons' || msg.type === 'template_button_reply') {
      try {
        console.log(`[${sessionId}] DIAG list/buttons msg.type=${msg.type} rawData=${JSON.stringify(msg.rawData).slice(0, 2000)}`)
      } catch (e) {
        console.log(`[${sessionId}] DIAG list/buttons stringify failed: ${e.message}`)
      }
    }

    // Native WhatsApp list/button menus never reached Andy with their actual
    // option text — msg.body only carries the header/preamble (confirmed live
    // in prod: "Selecciona una opción:" with nothing to pick from). Andy's
    // prompt already knows how to act on a "[Opciones: A | B | C]" suffix (the
    // same format Evolution/WAHA/Wasender already produce via
    // _extract_body_and_interactive on the backend) — appending it here once
    // means the backend doesn't need a wwebjs-specific parser at all.
    // Field paths below come from whatsapp-web.js's own OUTGOING list/buttons
    // send code (Injected/Utils.js: rawData.list.sections[].rows[].title,
    // rawData.dynamicReplyButtons[].buttonText.displayText) — unverified
    // against a live INCOMING example (none seen yet), so this best-effort
    // extraction can only ever add options, never remove msg.body — if the
    // shape doesn't match, behavior is identical to before (no options, same
    // as today).
    let messageBody = msg.body
    // Structured form of the same extraction below — mirrors the shape the
    // backend's _extract_body_and_interactive() already builds for Evolution/
    // WAHA ({type, text, options}), so conversations.jsx's existing
    // InteractiveMessage component (which only ever got fed by those two
    // providers) can render wwebjs button/list messages as real option chips
    // too, instead of relying on the frontend to re-parse the "[Opciones: ...]"
    // text suffix (which nothing does today — it just prints as plain text).
    let interactive = null
    if (msg.type === 'list' || msg.type === 'buttons') {
      try {
        const raw = msg.rawData || {}
        const titles = []
        if (raw.list && Array.isArray(raw.list.sections)) {
          for (const section of raw.list.sections) {
            for (const row of (section.rows || [])) {
              if (row.title) titles.push(row.title)
            }
          }
        }
        for (const key of ['dynamicReplyButtons', 'replyButtons', 'buttons']) {
          if (titles.length) break
          if (Array.isArray(raw[key])) {
            for (const btn of raw[key]) {
              const label = btn.buttonText?.displayText || btn.displayText || btn.body
              if (label) titles.push(label)
            }
          }
        }
        if (titles.length) {
          messageBody = `${msg.body}\n[Opciones: ${titles.join(' | ')}]`
          interactive = { type: msg.type === 'list' ? 'list' : 'buttons', text: msg.body, options: titles }
          console.log(`[${sessionId}] extracted ${titles.length} menu option(s) from ${msg.type} message`)
        }
      } catch (e) {
        console.log(`[${sessionId}] menu option extraction failed: ${e.message}`)
      }
    }

    // Actually fetch image/sticker/document bytes so the backend can store and
    // show them — previously hasMedia was forwarded but the real content was
    // never downloaded, so a shared photo/sticker/PDF only ever showed up as a
    // "[image]"/"[sticker]"/"[document]" placeholder chip, never the real
    // file (real case: Grupo Hakkasan's events brochure PDF, 2026-09-17 — the
    // caption came through but the attached PDF itself vanished). Not video/
    // audio yet — those still have no frontend renderer.
    let media = null
    if (msg.hasMedia && (msg.type === 'image' || msg.type === 'sticker' || msg.type === 'document')) {
      try {
        const m = await msg.downloadMedia()
        if (m && m.data) media = { data: m.data, mimetype: m.mimetype, filename: m.filename || null }
      } catch (e) {
        console.error(`[${sessionId}] downloadMedia failed:`, e.message)
      }
    }

    forwardWebhook({
      event: 'messages.received',
      sessionId,
      data: {
        from: msg.from,
        to: msg.to,
        fromMe: false,
        number,
        body: messageBody,
        type: msg.type,
        messageId: msg.id._serialized,
        timestamp: msg.timestamp,
        hasMedia: msg.hasMedia,
        media,
        interactive,
        // The backend's status/broadcast filter checks these three fields, but
        // until now they were never actually sent — only the literal "@broadcast"
        // JID substring match could ever fire. Forwarding them makes that filter
        // work as its own comment already claimed it did (e.g. a reply to your
        // own status, which whatsapp-web.js flags via isStatusReply rather than
        // a distinctive JID, was previously not caught at all).
        isStatus: !!msg.isStatus,
        isStatusReply: !!msg.isStatusReply,
        chatId: msg.from,
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

  // Stored so destroySessionClient() can wait for this launch to actually
  // finish (or fail) before tearing down — see its own comment for why.
  session.initPromise = client.initialize().catch((e) => {
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
  // A container that's just booting can never have a legitimate live process
  // holding these — Chrome's SingletonLock/-Cookie/-Socket only survive an
  // unclean shutdown (e.g. a redeploy that recreates the container without
  // Chromium exiting cleanly first), and a stale one makes the NEXT launch
  // refuse to start ("profile in use by another Chromium process"). Clearing
  // them unconditionally on boot is safe — no other process can hold them.
  for (const dir of dirs) clearSessionLockFiles(dir.replace('session-', ''))
  dirs.forEach((dir, i) => {
    const sessionId = dir.replace('session-', '')
    setTimeout(() => {
      console.log(`[startup] Restoring session: ${sessionId}`)
      createClient(sessionId)
    }, i * 15000)
  })
}

// A session sitting in "need_scan" keeps its Chromium instance alive
// indefinitely, regenerating a fresh QR/pairing code forever — whatsapp-web.js
// has no built-in "nobody's watching" concept. That's fine right after a
// scan-worthy state starts, but a session that never gets scanned (or whose
// LocalAuth was invalid on restore, so it never even had a real disconnect
// event to trigger the OTHER "destroy on logout" cleanup below) burns real
// CPU/memory forever, competing with the OTHER, actually-connected sessions
// for the same host (observed live 2026-09-17: tania-sesion-3 and gely-test2
// generating fresh QR/codes non-stop for hours with nobody reconnecting them,
// while sender4/sender666's own presence/profile-sync calls started timing
// out from the contention). Fix: track the last time /status, /qr or
// /pairing-code was actually polled (the reconnect dialog does this on a tight
// loop while open); once it's been idle for IDLE_RECONNECT_TIMEOUT_MS with no
// poll, destroy the browser and drop the session entirely — the NEXT poll
// then sees "not_found", which the frontend already handles by calling
// /start again (fresh boot, on demand) exactly like a never-started session.
const IDLE_RECONNECT_TIMEOUT_MS = 3 * 60 * 1000

// Serializes teardown/recreate for a given session id across BOTH this sweep
// and the /session/:id/start route below — without sharing one lock, the
// sweep could destroy a session at the exact moment a fresh /start call for
// it was already in flight, and the two would fight over the same Chromium
// userDataDir ("The browser is already running for ... Use a different
// userDataDir or stop the running browser first" — real case: gely-test2,
// 2026-09-17, stuck cycling that error after the sweep and a reconnect
// attempt landed back to back).
const _startLocks = new Map() // sessionId -> Promise (settles when the last queued op on it is done)

function sweepIdleReconnectSessions() {
  const now = Date.now()
  for (const [id, session] of sessions) {
    if (session.status !== 'need_scan') continue
    if (now - (session.lastPolledAt || 0) < IDLE_RECONNECT_TIMEOUT_MS) continue
    const prior = _startLocks.get(id) || Promise.resolve()
    const teardown = prior.then(async () => {
      // Re-check under the lock — a queued /start may have already replaced
      // or refreshed this session while we were waiting our turn.
      const current = sessions.get(id)
      if (!current || current !== session) return
      if (Date.now() - (current.lastPolledAt || 0) < IDLE_RECONNECT_TIMEOUT_MS) return
      console.log(`[${id}] idle reconnect (no poll in ${Math.round(IDLE_RECONNECT_TIMEOUT_MS / 60000)}min) — stopping QR/code generation until requested again`)
      clearInterval(current.presenceTimer)
      clearInterval(current.profileSyncTimer)
      clearInterval(current.heartbeatTimer)
      clearTimeout(current.reconnectTimer)
      clearTimeout(current.readyWatchdog)
      await destroySessionClient(current.client, id, current.initPromise)
      sessions.delete(id)
    }).catch(() => {})
    _startLocks.set(id, teardown)
  }
}

// ─── Routes ────────────────────────────────────────────────────────────────

// Serializes concurrent /session/:id/start calls for the SAME id — switching
// the QR/Pairing-code tab quickly fires teardown-then-recreate more than
// once, and without this a second call could read `existing` before the
// first call's destroy()+delete finished, launching a second Chromium for
// the same session (real user report: 2026-09-17, both a QR and a
// pairing-code client appeared to be alive at once after rapid tab
// switching). Each call now waits for the previous one on that id to fully
// settle before doing its own teardown/recreate, so only ever one client
// exists per session id. (_startLocks itself is declared above, shared with
// sweepIdleReconnectSessions() so the two never race each other either.)
app.post('/session/:id/start', async (req, res) => {
  const { id } = req.params
  const phoneNumber = (req.body && req.body.phoneNumber) || undefined
  const prior = _startLocks.get(id) || Promise.resolve()
  const thisCall = prior.then(async () => {
    const existing = sessions.get(id)
    if (existing) {
      // A mode switch is either direction: no phoneNumber before, one now (QR
      // -> pairing code) or the reverse (pairing code -> QR, phoneNumber now
      // absent). Only the QR->code direction used to be handled — switching
      // BACK to QR fell into the "just report status" branch below, leaving
      // the existing client stuck in pairing-code mode (which never emits a
      // 'qr' event at all, per whatsapp-web.js) while the frontend polled
      // GET /qr forever. That's the exact reconnect-dialog "loop" reported
      // 2026-09-21 when switching the link method back and forth.
      const modeChanged = Boolean(existing.phoneNumber) !== Boolean(phoneNumber)
      if (!phoneNumber && !modeChanged) {
        // No phone number given and the mode hasn't changed — just report current status.
        return { status: existing.status, phone: existing.phone }
      }
      // Either a phone number was given (switching to pairing-code mode) or
      // the existing session was in pairing-code mode and now needs QR
      // (modeChanged) — recreate fresh in the requested mode. Same teardown
      // as DELETE /session/:id — never touches the saved LocalAuth files, and
      // goes through destroySessionClient() so a slow/stuck browser.close()
      // can't leave an orphaned Chrome process holding this same userDataDir
      // for the createClient() call right below.
      clearInterval(existing.presenceTimer)
      clearInterval(existing.profileSyncTimer)
      clearInterval(existing.heartbeatTimer)
      clearTimeout(existing.reconnectTimer)
      clearTimeout(existing.readyWatchdog)
      await destroySessionClient(existing.client, id, existing.initPromise)
      sessions.delete(id)
    }
    const session = createClient(id, phoneNumber)
    return { status: session.status }
  })
  // Chain continues (success or failure) so the NEXT call always waits for
  // this one, but this route's own response reflects only its own outcome.
  _startLocks.set(id, thisCall.catch(() => {}))
  let result
  try {
    result = await thisCall
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
  res.json(result)
})

app.get('/session/:id/qr', async (req, res) => {
  const { id } = req.params
  const session = sessions.get(id)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  session.lastPolledAt = Date.now()
  if (!session.qr) return res.status(400).json({ error: 'No QR available', status: session.status })
  try {
    const qrImage = await QRCode.toDataURL(session.qr)
    res.json({ qr: qrImage, status: session.status })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/session/:id/pairing-code', (req, res) => {
  const { id } = req.params
  const session = sessions.get(id)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  session.lastPolledAt = Date.now()
  if (!session.pairingCode) return res.status(400).json({ error: 'No pairing code available', status: session.status })
  res.json({ code: session.pairingCode, status: session.status })
})

app.get('/session/:id/status', (req, res) => {
  const { id } = req.params
  const session = sessions.get(id)
  if (!session) return res.json({ status: 'not_found' })
  // Only counts as "someone's watching" while a reconnect is actually pending —
  // a connected session's dashboard/health polling shouldn't count toward its
  // own idle timer (that timer only applies to need_scan/initializing anyway,
  // see sweepIdleReconnectSessions(), but keep this scoped defensively).
  if (session.status === 'need_scan' || session.status === 'initializing') {
    session.lastPolledAt = Date.now()
  }
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
        // A real person doesn't save a brand-new contact and start typing to them
        // within ~1.5s — that mechanical save→type gap is itself a bot tell, on
        // top of everything else that makes a first-ever message to a stranger
        // already the riskiest send this service makes (real incidents,
        // 2026-09-21: 3 separate sessions got logged out by WhatsApp seconds
        // after this exact save-then-send sequence, each on a brand-new
        // prospect contact — tania-sesion-1/3/4). Gives a beat between "just
        // added them" and "composing a message" before the typing-indicator/
        // send flow below even starts.
        const saveToComposeGap = 6000 + Math.floor(Math.random() * 14000)  // 6-20s
        console.log(`[${id}] pausing ${saveToComposeGap}ms after saving contact before composing`)
        await new Promise(r => setTimeout(r, saveToComposeGap))
      } catch (_) {}
    }

    const numberId = await session.client.getNumberId(digits).catch(() => null)
    if (!numberId) return res.status(400).json({ error: `Number ${digits} not found on WhatsApp` })

    // Human-like typing delay. Goes straight through window.WWebJS.sendChatstate()
    // instead of chat.sendStateTyping() — confirmed against whatsapp-web.js's own
    // source (util/Injected/Utils.js) that sendStateTyping() itself does nothing
    // but forward the chat's raw id to that same bridge call, so resolving a full
    // Chat object via getChatById() first was an unnecessary step, and one that
    // throws for a brand-new contact with no existing chat thread yet (confirmed
    // live: silently ate the error and skipped the typing bubble for every
    // first-ever message to a number — exactly the "single send never shows the
    // bubble" case, same family of bug as the getChat()-can't-resolve-self issue
    // fixed above for fetchProfilePicUrl). This bypasses that resolution entirely.
    const delay = typingMs !== undefined ? typingMs : humanTypingMs(message)
    if (delay > 0) {
      try {
        await session.client.pupPage.evaluate((chatId) => window.WWebJS.sendChatstate('typing', chatId), numberId._serialized)
        await new Promise(r => setTimeout(r, delay))
        await session.client.pupPage.evaluate((chatId) => window.WWebJS.sendChatstate('stop', chatId), numberId._serialized)
      } catch (typingErr) {
        console.log(`[${id}] typing indicator failed for ${digits}: ${typingErr.message}`)
      }
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

  const { to, mediaUrl, filename, caption, typingMs, asSticker } = req.body
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

    const media = stripMediaCollisionId(await MessageMedia.fromUrl(mediaUrl, { unsafeMime: true }))
    if (filename) media.filename = filename

    const msg = await session.client.sendMessage(numberId._serialized, media, asSticker
      ? { sendMediaAsSticker: true }
      : { caption: caption || '', sendMediaAsDocument: !media.mimetype.startsWith('image/') },
    )
    session.lastSendAt = Date.now()

    console.log(`[${id}] ✓ media sent → ${digits} (${media.mimetype}) ${filename || ''}`)
    // msg.id can come back undefined here as a side effect of the __x_id
    // patch above (Utils.js) — the send itself genuinely succeeds (confirmed
    // live, 2026-09-21: message + caption both arrived), this is just our own
    // response failing to build afterward. Don't let a missing id turn a real
    // successful send into a reported failure.
    res.json({ success: true, messageId: msg?.id?._serialized || null, phone: digits, mimetype: media.mimetype })
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

// WhatsApp Web lazy-loads the WAWebSetPushnameConnAction module (used by
// setDisplayName() internally) only after a human opens the "You" profile
// drawer at least once — a headless session never does, so the call throws
// "Cannot read properties of undefined (reading 'setPushname')" on a fresh
// connection. Confirmed live (2026-09-14): the module reports as unloaded on
// a freshly (re)connected session, and the profile nav item is the LAST
// [data-navbar-item="true"] entry, currently aria-label="You" (WhatsApp's own
// label for it, not literally "Profile"). Clicking it once forces the same
// lazy-load a human triggers, then Escape closes the drawer back out — no
// visible WhatsApp-side change either way.
// setProfilePicture() uses a different set of modules (WAWebCollections /
// WAWebContactProfilePicThumbBridge) that haven't actually been confirmed to
// need this same nudge — reusing this helper there is a reasonable bet
// (opening the drawer plausibly loads the whole profile-related chunk
// together) but is UNVERIFIED until tested against a real picture change.
async function ensureProfileModuleLoaded(page) {
  const check = () => page.evaluate(() => {
    try { return !!window.require('WAWebSetPushnameConnAction') } catch { return false }
  })

  const alreadyLoaded = await check()
  if (alreadyLoaded) return { ok: true, alreadyLoaded: true }

  // A generic "What's new on WhatsApp Web" announcement modal shows up on
  // every fresh page load (confirmed live, 2026-09-14) and sits on top of
  // whatever we open next — it was the ONLY [role="dialog"] our debug capture
  // ever found, meaning the real profile drawer was never what we were
  // reading. Dismiss it first so it's not in the way of the actual click.
  const dismissed = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')
    if (!dialog) return false
    const btn = [...dialog.querySelectorAll('button, div[role="button"]')]
      .find(b => /continue|got it|ok/i.test(b.textContent || ''))
    if (btn) { btn.click(); return true }
    return false
  })
  if (dismissed) await new Promise(r => setTimeout(r, 500))
  await page.keyboard.press('Escape').catch(() => {})
  await new Promise(r => setTimeout(r, 300))

  const clickInfo = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[data-navbar-item="true"]')]
    const profileItem = items[items.length - 1]
    if (!profileItem) return { clicked: false, navCount: items.length }
    profileItem.click()
    return { clicked: true, navCount: items.length, ariaLabel: profileItem.getAttribute('aria-label') }
  })

  // The "You" nav item opens WhatsApp's SETTINGS menu, not the profile editor
  // directly (confirmed via a real screenshot, 2026-09-14) — it's a list with
  // its own "Profile" row ("Name, profile picture, username") that has to be
  // clicked next to reach the actual editor where the lazy module loads.
  await new Promise(r => setTimeout(r, 800))
  const profileRowClicked = await page.evaluate(() => {
    const leaf = [...document.querySelectorAll('div, span')]
      .find(el => el.children.length === 0 && el.textContent.trim() === 'Profile')
    if (!leaf) return false
    leaf.click()
    return true
  })

  // Give the panel real time to mount and its lazy chunk to import — 1.5s
  // wasn't enough on the first live attempt (2026-09-14), try a longer wait
  // and poll instead of a single fixed sleep. Confirmed live: the drawer
  // itself (data-testid="drawer-fullscreen") opens correctly but can still be
  // empty (no text, no editable fields) several iterations in — poll until it
  // actually has content, not just until the module check flips.
  let loaded = false
  let panelHasContent = false
  for (let i = 0; i < 14; i++) {
    await new Promise(r => setTimeout(r, 500))
    loaded = await check()
    if (loaded) break
    panelHasContent = await page.evaluate(() => {
      const p = document.querySelector('[data-testid="drawer-fullscreen"], [data-testid*="drawer" i]')
      return !!p && (p.innerText || '').trim().length > 0
    })
    if (panelHasContent) {
      // Content showed up but module still isn't registered yet — a couple
      // more polls give the lazy chunk time to finish importing now that we
      // know we're looking at the right panel.
      for (let j = 0; j < 4; j++) {
        await new Promise(r => setTimeout(r, 500))
        loaded = await check()
        if (loaded) break
      }
      break
    }
  }

  // Didn't load from just opening the "You" tab — capture what's actually
  // rendered so the next iteration can target the real element instead of
  // guessing again (WhatsApp likely lazy-loads the edit action per-field,
  // e.g. only once you click into the name field itself, not just the tab).
  let panelDebug = null
  let screenshot = null
  if (!loaded) {
    panelDebug = await page.evaluate(() => {
      const editable = [...document.querySelectorAll('[contenteditable="true"], [data-icon*="pencil" i], [data-icon*="edit" i]')]
        .slice(0, 15)
        .map(el => ({
          tag: el.tagName, dataIcon: el.getAttribute('data-icon'),
          ariaLabel: el.getAttribute('aria-label'), title: el.getAttribute('title'),
          text: (el.textContent || '').slice(0, 40),
        }))
      const panel = document.querySelector('[data-testid*="drawer" i], [role="dialog"], #app > div > span > div')
      return {
        editable,
        panelTestId: panel ? panel.getAttribute('data-testid') : null,
        panelText: panel ? panel.innerText.slice(0, 2500) : 'no panel/dialog found',
      }
    })
    // Text-scraping guesses have gone in circles for a while now — a real
    // screenshot of what's actually on screen settles it in one shot instead
    // of another blind iteration.
    try {
      screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 60 })
    } catch (e) {
      screenshot = null
    }
  }

  // Two levels deep now (You -> Profile) — one Escape per level to fully
  // back out instead of leaving the Settings menu open behind us.
  await page.keyboard.press('Escape').catch(() => {})
  await new Promise(r => setTimeout(r, 200))
  await page.keyboard.press('Escape').catch(() => {})

  return { ok: loaded, ...clickInfo, profileRowClicked, polledLoaded: loaded, panelHasContent, panelDebug, screenshot }
}

// Set the real WhatsApp profile name (pushname) — this is the account's
// actual display name, distinct from the app's own internal instance label
// (which InstancesPanel.jsx already lets you edit) and from Andy's
// conversation persona name (which now reads THIS value so it never claims a
// name that doesn't match the connected profile).
app.post('/session/:id/profile/name', async (req, res) => {
  const { id } = req.params
  const session = sessions.get(id)
  if (!session || session.status !== 'connected') return res.status(400).json({ error: 'Not connected' })
  const { name } = req.body
  if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'name string required' })
  try {
    const moduleStatus = await ensureProfileModuleLoaded(session.client.pupPage)
    if (!moduleStatus.ok) return res.status(503).json({ error: 'WhatsApp Web profile module did not load — try again in a moment', debug: moduleStatus })
    const ok = await session.client.setDisplayName(name.trim())
    if (!ok) return res.status(409).json({ error: 'WhatsApp refused the name change (rate-limited or not permitted right now)' })
    // Keep the periodic outside-the-app poll's baseline in sync with a change
    // WE just made — otherwise its next tick sees this as an "external" change
    // and fires a redundant webhook for something already synced above.
    session.lastPushname = name.trim()
    res.json({ success: true, name: name.trim() })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Set the real WhatsApp profile picture from a public image URL.
app.post('/session/:id/profile/picture', async (req, res) => {
  const { id } = req.params
  const session = sessions.get(id)
  if (!session || session.status !== 'connected') return res.status(400).json({ error: 'Not connected' })
  const { imageUrl } = req.body
  if (typeof imageUrl !== 'string' || !imageUrl.trim()) return res.status(400).json({ error: 'imageUrl string required' })
  try {
    const media = stripMediaCollisionId(await MessageMedia.fromUrl(imageUrl, { unsafeMime: true }))
    if (!media.mimetype.startsWith('image/')) return res.status(400).json({ error: `URL is not an image (${media.mimetype})` })
    const moduleStatus = await ensureProfileModuleLoaded(session.client.pupPage)
    if (!moduleStatus.ok) return res.status(503).json({ error: 'WhatsApp Web profile module did not load — try again in a moment', debug: moduleStatus })
    const ok = await session.client.setProfilePicture(media)
    if (!ok) return res.status(409).json({ error: 'WhatsApp refused the picture change' })
    // Confirmed live (2026-09-15): the change lands on WhatsApp's side, but our
    // own backend only ever synced instances.profile_pic_url from the
    // session.status webhook, which only fires on a real connect/reconnect —
    // never right after an in-place picture change. Fetch the fresh URL here
    // and hand it back so the caller can sync it immediately instead of
    // waiting for the account to reconnect.
    const profile_pic_url = await fetchProfilePicUrl(session.client, id)
    if (profile_pic_url) session.lastProfilePicUrl = profile_pic_url
    res.json({ success: true, profile_pic_url })
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
  // Same lock as /start and the idle sweep — without it, this could race a
  // concurrent /start for the same id and both end up fighting over the same
  // Chromium userDataDir.
  const prior = _startLocks.get(id) || Promise.resolve()
  const thisCall = prior.then(async () => {
    const session = sessions.get(id)
    if (!session) return { notFound: true }
    clearInterval(session.presenceTimer)
    clearInterval(session.profileSyncTimer)
    clearInterval(session.heartbeatTimer)
    clearTimeout(session.reconnectTimer)
    clearTimeout(session.readyWatchdog)
    await destroySessionClient(session.client, id, session.initPromise)
    sessions.delete(id)
    return { notFound: false }
  })
  _startLocks.set(id, thisCall.catch(() => {}))
  let result
  try {
    result = await thisCall
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
  if (result.notFound) return res.status(404).json({ error: 'Session not found' })
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

// Graceful shutdown — without this, `docker stop` SIGKILLs the process after
// its grace period with no warning to Puppeteer/Chromium, which can leave a
// session's LocalAuth profile (the IndexedDB/LevelDB files under
// /app/sessions) mid-write and corrupted. Confirmed live in prod
// (tania-sesion-3, 2026-09-16): no disconnect/logout event was ever recorded
// for it — it simply failed to restore its saved session on the next start
// and fell back to needing a fresh QR scan, right after a routine restart.
// client.destroy() only closes the browser cleanly and lets Chromium flush
// its profile to disk — confirmed against whatsapp-web.js's own source that
// this can only help, never wipe anything: LocalAuth doesn't override
// destroy() (inherits a no-op from BaseAuthStrategy), only logout() — a
// separate, explicit method that deletes the session files and is never
// called here.
let _shuttingDown = false
async function _gracefulShutdown(signal) {
  if (_shuttingDown) return
  _shuttingDown = true
  console.log(`[shutdown] ${signal} received — closing ${sessions.size} session(s) cleanly`)
  const closes = Array.from(sessions.values()).map(s => (s.client?.destroy() || Promise.resolve()).catch(() => {}))
  await Promise.race([
    Promise.all(closes),
    new Promise((r) => setTimeout(r, 8000)), // don't hang forever if a browser is stuck
  ])
  console.log('[shutdown] done')
  process.exit(0)
}
process.on('SIGTERM', () => _gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => _gracefulShutdown('SIGINT'))

app.listen(PORT, () => {
  console.log(`wwebjs-service on port ${PORT}`)
  autoRestoreSessions()
  setInterval(sweepIdleReconnectSessions, 60 * 1000)
})
