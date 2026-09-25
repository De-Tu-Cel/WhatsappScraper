// Minimal SOCKS5 relay (CONNECT command only, no auth) — bound to the
// WireGuard tunnel IP so only the server (over the tunnel) can reach it.
// Purpose: let a single wwebjs session on the server exit through this
// machine's home internet connection, via wwebjs's existing PROXY_SERVER
// support (apps/wwebjs/index.js).
const net = require('net')

const BIND_ADDR = process.env.BIND_ADDR || '10.200.0.2'
const BIND_PORT = Number(process.env.BIND_PORT || 1080)

function handshake(socket) {
  socket.once('data', (greeting) => {
    if (greeting[0] !== 0x05) return socket.destroy()
    // No-auth accepted regardless of what the client offered.
    socket.write(Buffer.from([0x05, 0x00]))
    socket.once('data', (req) => onRequest(socket, req))
  })
}

function onRequest(socket, req) {
  if (req[0] !== 0x05 || req[1] !== 0x01) {
    // Only CONNECT supported.
    socket.end(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
    return
  }
  const atyp = req[3]
  let host, port, offset
  if (atyp === 0x01) { // IPv4
    host = `${req[4]}.${req[5]}.${req[6]}.${req[7]}`
    offset = 8
  } else if (atyp === 0x03) { // domain
    const len = req[4]
    host = req.subarray(5, 5 + len).toString('ascii')
    offset = 5 + len
  } else if (atyp === 0x04) { // IPv6
    const parts = []
    for (let i = 0; i < 16; i += 2) parts.push(req.readUInt16BE(4 + i).toString(16))
    host = parts.join(':')
    offset = 20
  } else {
    socket.end(Buffer.from([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
    return
  }
  port = req.readUInt16BE(offset)

  const upstream = net.connect(port, host, () => {
    socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
    upstream.pipe(socket)
    socket.pipe(upstream)
  })
  upstream.on('error', () => {
    try { socket.end(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0])) } catch (_) {}
  })
  socket.on('error', () => upstream.destroy())
}

const server = net.createServer((socket) => {
  socket.on('error', () => {})
  handshake(socket)
})

server.listen(BIND_PORT, BIND_ADDR, () => {
  console.log(`[socks5-relay] listening on ${BIND_ADDR}:${BIND_PORT}`)
})
