// dsh-plugin-qr-connect — reverse proxy child process.
// Auth-gated HTTP reverse proxy + WebSocket tunnel that exposes the loopback
// DSH web UI on 0.0.0.0:<port>. A request carrying `?auth=<secret>` is issued a
// session cookie; a request carrying a valid session cookie is proxied. The
// secret rotates every `rotateMs` and is published to `stateFile` so the host
// plugin can build QR URLs.
const http = require('http')
const crypto = require('crypto')
const fs = require('fs')

function arg(name, dflt) {
  const i = process.argv.indexOf(name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}

const port = parseInt(arg('--port', '8088'), 10)
const upstream = arg('--upstream', 'http://127.0.0.1:3080')
const ttlSeconds = parseInt(arg('--ttl-seconds', '2592000'), 10)
const rotateMs = parseInt(arg('--rotate-ms', '30000'), 10)
const stateFile = arg('--state-file', '/tmp/dsh-lan-proxy-state.json')
const up = new URL(upstream)

let currentSecret = ''
let previousSecret = ''
const CRLF = String.fromCharCode(13, 10)

function rotate() {
  previousSecret = currentSecret
  currentSecret = crypto.randomBytes(16).toString('hex')
  try { fs.writeFileSync(stateFile, JSON.stringify({ secret: currentSecret, updatedAt: Date.now() })) } catch (e) {}
}

const sessions = new Map()
function prune() {
  const now = Date.now()
  for (const k of sessions.keys()) { if (sessions.get(k) < now) sessions.delete(k) }
}
function issue() {
  prune()
  const t = crypto.randomBytes(32).toString('hex')
  sessions.set(t, Date.now() + ttlSeconds * 1000)
  return t
}
function valid(t) {
  prune()
  return !!t && sessions.has(t) && sessions.get(t) > Date.now()
}
function sessionCookie(req) {
  const h = req.headers.cookie || ''
  for (const part of h.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() === 'dsh_proxy_session') return part.slice(eq + 1).trim()
  }
  return null
}

function proxy(req, res) {
  const headers = {}
  for (const k of Object.keys(req.headers)) headers[k] = req.headers[k]
  headers.host = up.host
  if (headers.origin) headers.origin = up.origin
  const preq = http.request({ hostname: up.hostname, port: up.port || 80, path: req.url, method: req.method, headers: headers }, function (pres) {
    res.writeHead(pres.statusCode, pres.headers)
    pres.pipe(res)
  })
  preq.on('error', function () { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('Bad gateway') })
  req.pipe(preq)
}

const server = http.createServer(function (req, res) {
  const u = new URL(req.url, 'http://localhost')
  const auth = u.searchParams.get('auth')
  if (auth) {
    if (auth === currentSecret || auth === previousSecret) {
      const token = issue()
      res.writeHead(302, { 'Set-Cookie': 'dsh_proxy_session=' + token + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + ttlSeconds, 'Location': '/' })
      res.end()
      return
    }
    res.writeHead(401, { 'Content-Type': 'text/plain' })
    res.end('Unauthorized')
    return
  }
  if (valid(sessionCookie(req))) { proxy(req, res); return }
  res.writeHead(401, { 'Content-Type': 'text/plain' })
  res.end('Unauthorized')
})

rotate()
if (rotateMs > 0) setInterval(rotate, rotateMs)
process.on('SIGUSR1', function () { rotate() })

server.on('upgrade', function (req, socket, head) {
  if (!valid(sessionCookie(req))) {
    socket.write('HTTP/1.1 401 Unauthorized' + CRLF + CRLF)
    socket.destroy()
    return
  }
  const headers = {}
  for (const k of Object.keys(req.headers)) headers[k] = req.headers[k]
  headers.host = up.host
  if (headers.origin) headers.origin = up.origin
  const proxyReq = http.request({ hostname: up.hostname, port: up.port || 80, path: req.url, method: req.method, headers: headers })
  proxyReq.on('upgrade', function (proxyRes, proxySocket, proxyHead) {
    let resHead = 'HTTP/1.1 101 Switching Protocols' + CRLF
    for (const k of Object.keys(proxyRes.headers)) resHead += k + ': ' + proxyRes.headers[k] + CRLF
    resHead += CRLF
    socket.write(resHead)
    socket.pipe(proxySocket)
    proxySocket.pipe(socket)
    if (proxyHead && proxyHead.length) proxySocket.unshift(proxyHead)
    if (head && head.length) proxySocket.write(head)
    proxySocket.on('error', function () { socket.destroy() })
    socket.on('error', function () { proxySocket.destroy() })
    proxySocket.on('close', function () { socket.destroy() })
    socket.on('close', function () { proxySocket.destroy() })
  })
  proxyReq.on('error', function () { socket.destroy() })
  proxyReq.end()
})

server.on('error', function (e) { console.error('dsh-lan-proxy error: ' + e.message) })
server.listen(port, '0.0.0.0', function () { console.error('dsh-lan-proxy listening on ' + port) })
