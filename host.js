// DSH dynamic Cordis plugin — Host half (value of `code.host` in cordis_define).
// Exposes a package-private RPC handler `lan-ip` that returns the machine's
// primary non-loopback IPv4 address. The client half calls it and combines the
// result with the browser's own origin (protocol + port) to build the URL a
// phone on the same network should open.
return {
  apply(ctx) {
    harness.handle('lan-ip', async () => {
      const shell = ctx.get('shell')
      if (shell === undefined) return { ip: null }
      try {
        const command = "ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1; hostname -I 2>/dev/null | awk '{for(i=1;i<=NF;i++) print $i}'"
        const spec = shell.resolve({ command: command, stdoutMaxBytes: 256 })
        const res = await shell.run(spec)
        const text = (res && res.stdout && res.stdout.text) || ''
        const candidates = text.split(/\s+/).map((s) => s.trim()).filter(Boolean)
        const ip = candidates.find((s) => /^(\d{1,3}\.){3}\d{1,3}$/.test(s) && !s.startsWith('127.') && !s.startsWith('169.254.')) || null
        return { ip: ip }
      } catch (err) {
        return { ip: null }
      }
    })
  },
}
