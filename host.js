// DSH dynamic Cordis plugin — Host half (value of `code.host` in cordis_define).
// Runs a small auth-gated reverse proxy (a child `node` process) that listens on
// 0.0.0.0:<PROXY_PORT> and forwards to the loopback web server. A request
// carrying a valid `?auth=<secret>` is issued a session cookie; a request
// carrying a valid session cookie is proxied. The secret rotates every 30s and
// is published to a state file the client reads to build the QR URLs.
return {
  apply(ctx) {
    const DEFAULT_PORT = 8088
    const DEFAULT_SESSION_DAYS = 30
    const SCRIPT_PATH = '/tmp/dsh-lan-proxy.js'
    const STATE_PATH = '/tmp/dsh-lan-proxy-state.json'
    const POLYFILL_SCRIPT = `<script>/*dsh-rnd-uuid-polyfill*/if(window.crypto&&typeof window.crypto.randomUUID!=='function'){window.crypto.randomUUID=function(){var b=new Uint8Array(16);window.crypto.getRandomValues(b);b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;var s='';for(var i=0;i<16;i++)s+=('00'+b[i].toString(16)).slice(-2);return s.slice(0,8)+'-'+s.slice(8,12)+'-'+s.slice(12,16)+'-'+s.slice(16,20)+'-'+s.slice(20)}};</script>`

    const PROXY_SCRIPT = `const http = require('http')
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
setInterval(rotate, rotateMs)
server.on('error', function (e) { console.error('dsh-lan-proxy error: ' + e.message) })
server.listen(port, '0.0.0.0', function () { console.error('dsh-lan-proxy listening on ' + port) })
`

    let proxyProc = null
    let configPort = DEFAULT_PORT
    let configDays = DEFAULT_SESSION_DAYS

    async function detectLocalIp(shell) {
      if (shell === undefined) return null
      try {
        const command = "ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1; hostname -I 2>/dev/null | awk '{for(i=1;i<=NF;i++) print $i}'"
        const spec = shell.resolve({ command: command, stdoutMaxBytes: 256 })
        const res = await shell.run(spec)
        const text = (res && res.stdout && res.stdout.text) || ''
        const candidates = text.split(/\s+/).map((s) => s.trim()).filter(Boolean)
        return candidates.find((s) => /^(\d{1,3}\.){3}\d{1,3}$/.test(s) && !s.startsWith('127.') && !s.startsWith('169.254.')) || null
      } catch (err) {
        return null
      }
    }

    async function detectPublicIp(web) {
      if (web === undefined) return null
      try {
        const res = await web.fetch({ url: 'https://api.ipify.org' })
        if (res && res.statusCode >= 200 && res.statusCode < 300 && res.body && res.body.content) {
          const candidate = res.body.content.trim()
          if (/^(\d{1,3}\.){3}\d{1,3}$/.test(candidate) || candidate.indexOf(':') !== -1) return candidate
        }
        return null
      } catch (err) {
        return null
      }
    }

    function writeScript() {
      const fs = ctx.get('fs')
      if (fs === undefined) return Promise.resolve(false)
      return fs.resolve(SCRIPT_PATH).then((target) => fs.writeText(target, PROXY_SCRIPT)).then(() => true).catch(() => false)
    }

    function startProxy() {
      const subprocess = ctx.get('subprocess')
      if (subprocess === undefined) return
      if (proxyProc) { try { proxyProc.terminate() } catch (e) {} proxyProc = null }
      const webServer = ctx.get('webServer')
      const upstreamPort = (webServer && typeof webServer.port === 'number') ? webServer.port : 3080
      const ttlSeconds = Math.round(configDays * 86400)
      proxyProc = subprocess.spawn({
        argv: ['node', SCRIPT_PATH, '--port', String(configPort), '--upstream', 'http://127.0.0.1:' + upstreamPort, '--ttl-seconds', String(ttlSeconds), '--rotate-ms', '30000', '--state-file', STATE_PATH],
        cwd: '/tmp',
        stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
        graceMs: 1000,
      })
      if (proxyProc && proxyProc.stdout) proxyProc.stdout.resume()
      if (proxyProc && proxyProc.stderr) proxyProc.stderr.resume()
    }

    ctx.effect(() => {
      writeScript().then((ok) => { if (ok) startProxy() })
      return () => {
        if (proxyProc) { try { proxyProc.terminate() } catch (e) {} proxyProc = null }
      }
    })

    const webServer = ctx.get('webServer')
    if (webServer !== undefined) {
      ctx.effect(() => webServer.tapIndex((html) => {
        if (html.indexOf('dsh-rnd-uuid-polyfill') !== -1) return html
        return html.replace('<head>', '<head>' + POLYFILL_SCRIPT)
      }))
    }

    function readSecret() {
      const fs = ctx.get('fs')
      if (fs === undefined) return Promise.resolve(null)
      return fs.resolve(STATE_PATH).then((target) => fs.readText(target)).then((txt) => {
        try { return (JSON.parse(txt) || {}).secret || null } catch (e) { return null }
      }).catch(() => null)
    }

    harness.handle('proxy-info', async () => {
      const shell = ctx.get('shell')
      const web = ctx.get('web')
      const results = await Promise.all([readSecret(), detectLocalIp(shell), detectPublicIp(web)])
      return { secret: results[0], ip: results[1], publicIp: results[2], port: configPort }
    })

    harness.handle('get-config', async () => {
      return { port: configPort, sessionDays: configDays }
    })

    harness.handle('set-config', async (args) => {
      const nextPort = (args && typeof args.port === 'number' && args.port > 0 && args.port < 65536) ? args.port : configPort
      const nextDays = (args && typeof args.sessionDays === 'number' && args.sessionDays > 0 && args.sessionDays <= 3650) ? args.sessionDays : configDays
      if (nextPort !== configPort || nextDays !== configDays) {
        configPort = nextPort
        configDays = nextDays
        startProxy()
      }
      return { port: configPort, sessionDays: configDays }
    })
  },
}
