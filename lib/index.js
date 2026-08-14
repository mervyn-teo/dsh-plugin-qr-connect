import z from "@deepseek-ai/schemastery";

/** Plugin display name. */
const name = "dsh-plugin-qr-connect";

/** Reverse-proxy state file the child process publishes its rotating secret to. */
const STATE_PATH = "/tmp/dsh-lan-proxy-state.json";

/** crypto.randomUUID polyfill injected into the index HTML (secure-context only). */
const POLYFILL =
  `<script>/*dsh-rnd-uuid-polyfill*/if(window.crypto&&typeof window.crypto.randomUUID!=='function'){window.crypto.randomUUID=function(){var b=new Uint8Array(16);window.crypto.getRandomValues(b);b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;var s='';for(var i=0;i<16;i++)s+=('00'+b[i].toString(16)).slice(-2);return s.slice(0,8)+'-'+s.slice(8,12)+'-'+s.slice(12,16)+'-'+s.slice(16,20)+'-'+s.slice(20)}};</script>`;

/** Default configuration. */
const DEFAULT_CONFIG = {
  port: 8088,
  sessionDays: 30,
  refreshSeconds: 30,
};

/**
 * Plugin configuration, set as the `config:` block on this plugin's loader
 * entry in the profile's cordis.patch.yml. The browser half can also adjust
 * these at runtime via POST /__qr/config.
 */
const Config = z.object({
  port: z.number().min(1).max(65535).default(DEFAULT_CONFIG.port)
    .description("Reverse-proxy listen port (the QR URLs point at this port)."),
  sessionDays: z.number().min(1).max(3650).default(DEFAULT_CONFIG.sessionDays)
    .description("Session cookie length in days."),
  refreshSeconds: z.number().min(0).max(86400).default(DEFAULT_CONFIG.refreshSeconds)
    .description("Seconds between secret rotations (0 disables auto-refresh)."),
});

/** Locate the shipped proxy child script. */
function resolveProxyPath() {
  try {
    return new URL("./proxy.cjs", import.meta.url).pathname;
  } catch {
    return null;
  }
}

/**
 * Run the auth-gated reverse proxy: registers the browser-facing state routes
 * and the index polyfill, and owns the child `node` process lifetime.
 * @param ctx - host cordis context.
 * @param config - normalized plugin configuration.
 */
function apply(ctx, config) {
  // Runtime-mutable config (POST /__qr/config may change it and respawn).
  const current = {
    port: config.port,
    sessionDays: config.sessionDays,
    refreshSeconds: config.refreshSeconds,
  };

  let proxyProc = null;
  const proxyPath = resolveProxyPath();

  async function readSecret(fs) {
    if (fs === undefined) return null;
    try {
      const target = await fs.resolve(STATE_PATH);
      const txt = await fs.readText(target);
      return (JSON.parse(txt) || {}).secret || null;
    } catch {
      return null;
    }
  }

  async function detectLocalIp(shell) {
    if (shell === undefined) return null;
    try {
      const command = "ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1; hostname -I 2>/dev/null | awk '{for(i=1;i<=NF;i++) print $i}'";
      const spec = shell.resolve({ command: command, stdoutMaxBytes: 256 });
      const res = await shell.run(spec);
      const text = (res && res.stdout && res.stdout.text) || "";
      const candidates = text.split(/\s+/).map((s) => s.trim()).filter(Boolean);
      return candidates.find((s) => /^(\d{1,3}\.){3}\d{1,3}$/.test(s) && !s.startsWith("127.") && !s.startsWith("169.254.")) || null;
    } catch {
      return null;
    }
  }

  async function detectPublicIp(shell) {
    if (shell === undefined) return null;
    try {
      const command = "curl -s --max-time 5 https://api.ipify.org 2>/dev/null || curl -s --max-time 5 https://api64.ipify.org 2>/dev/null";
      const spec = shell.resolve({ command: command, stdoutMaxBytes: 64 });
      const res = await shell.run(spec);
      const candidate = ((res && res.stdout && res.stdout.text) || "").trim();
      if (/^(\d{1,3}\.){3}\d{1,3}$/.test(candidate) || candidate.indexOf(":") !== -1) return candidate;
      return null;
    } catch {
      return null;
    }
  }

  function startProxy(deps) {
    const subprocess = deps.subprocess;
    if (subprocess === undefined || proxyPath === null) return;
    if (proxyProc) { try { proxyProc.terminate(); } catch { /* ignore */ } proxyProc = null; }
    const upstreamPort = (deps.webServer && typeof deps.webServer.port === "number") ? deps.webServer.port : 3080;
    const ttlSeconds = Math.round(current.sessionDays * 86400);
    proxyProc = subprocess.spawn({
      argv: ["node", proxyPath,
        "--port", String(current.port),
        "--upstream", "http://127.0.0.1:" + upstreamPort,
        "--ttl-seconds", String(ttlSeconds),
        "--rotate-ms", String(current.refreshSeconds * 1000),
        "--state-file", STATE_PATH],
      cwd: "/tmp",
      stdio: { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
      graceMs: 1000,
    });
    if (proxyProc && proxyProc.stdout) proxyProc.stdout.resume();
    if (proxyProc && proxyProc.stderr) proxyProc.stderr.resume();
  }

  ctx.inject(["subprocess", "fs", "shell", "webServer"], (deps) => {
    deps.effect(() => {
      startProxy(deps);

      const ws = deps.webServer;
      const json = (res, code, data) => {
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      };
      const readBody = async (req) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
      };
      const collect = () => Promise.all([
        readSecret(deps.fs),
        detectLocalIp(deps.shell),
        detectPublicIp(deps.shell),
      ]);

      const disposeInfo = ws.register({
        kind: "exact",
        path: "/__qr/info",
        handler: async (req, res) => {
          const [secret, ip, publicIp] = await collect();
          json(res, 200, { secret, ip, publicIp, port: current.port, refreshSeconds: current.refreshSeconds });
        },
      });

      const disposeRotate = ws.register({
        kind: "exact",
        path: "/__qr/rotate",
        handler: async (req, res) => {
          if (proxyProc && proxyProc.pid > 0) {
            try {
              const spec = deps.shell.resolve({ command: "kill -USR1 " + proxyProc.pid + "; sleep 0.2" });
              await deps.shell.run(spec);
            } catch { /* ignore */ }
          }
          const [secret, ip, publicIp] = await collect();
          json(res, 200, { secret, ip, publicIp, port: current.port, refreshSeconds: current.refreshSeconds });
        },
      });

      const disposeConfig = ws.register({
        kind: "exact",
        path: "/__qr/config",
        handler: async (req, res) => {
          if (req.method === "POST") {
            const body = await readBody(req);
            const nextPort = (typeof body.port === "number" && body.port > 0 && body.port < 65536) ? body.port : current.port;
            const nextDays = (typeof body.sessionDays === "number" && body.sessionDays > 0 && body.sessionDays <= 3650) ? body.sessionDays : current.sessionDays;
            const nextRefresh = (typeof body.refreshSeconds === "number" && body.refreshSeconds >= 0 && body.refreshSeconds <= 86400) ? body.refreshSeconds : current.refreshSeconds;
            if (nextPort !== current.port || nextDays !== current.sessionDays || nextRefresh !== current.refreshSeconds) {
              current.port = nextPort;
              current.sessionDays = nextDays;
              current.refreshSeconds = nextRefresh;
              startProxy(deps);
            }
          }
          json(res, 200, { port: current.port, sessionDays: current.sessionDays, refreshSeconds: current.refreshSeconds });
        },
      });

      const disposeTap = ws.tapIndex((html) => {
        if (html.indexOf("dsh-rnd-uuid-polyfill") !== -1) return html;
        return html.replace("<head>", "<head>" + POLYFILL);
      });

      return () => {
        disposeInfo();
        disposeRotate();
        disposeConfig();
        disposeTap();
        if (proxyProc) { try { proxyProc.terminate(); } catch { /* ignore */ } proxyProc = null; }
      };
    }, name + ": proxy and routes");
  });
}

export { Config, DEFAULT_CONFIG, apply, name };
