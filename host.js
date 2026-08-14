// DSH dynamic Cordis plugin — Host half (value of `code.host` in cordis_define).
// Exposes a package-private RPC handler `lan-ip` returning:
//   - `ip`:       the machine's primary non-loopback IPv4 (LAN) address.
//   - `publicIp`: the WAN/public IP reported by an echo service (may be null).
// The client half combines each with the browser's own origin (protocol + port)
// to build the URLs a phone should open.
return {
  apply(ctx) {
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
    harness.handle('lan-ip', async () => {
      const shell = ctx.get('shell')
      const web = ctx.get('web')
      const [ip, publicIp] = await Promise.all([detectLocalIp(shell), detectPublicIp(web)])
      return { ip: ip, publicIp: publicIp }
    })
  },
}
