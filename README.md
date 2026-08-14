# dsh-plugin-qr-connect

<p align="center">
  <a href="https://github.com/mervyn-teo/dsh-plugin-qr-connect">
    <img src="assets/banner.png" alt="dsh-plugin-qr-connect banner — scan to connect any device to your DeepSeek Harness web UI" width="100%">
  </a>
</p>

English | [中文](README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) Web
plugin that adds a **QR-code button above the Settings button** in the sidebar
footer. It runs a small auth-gated reverse proxy so a phone on the same network
(or the internet) can scan a QR code and open the web UI securely. It is a
persistent bundle plugin (a host half plus a browser half) that loads on every
boot.

## Demo

<p align="center">
  <img src="assets/demo-v2.gif" alt="dsh-plugin-qr-connect demo — click the QR button, scan, connect" width="360">
</p>

## What it does

- Adds a full-width button (`sidebar.footer.action`, id `qr-connect`) stacked
  **above** the shipped Plugins button.
- Opens a fading panel with **two** QR codes:
  - **Local network** — `http://<lan-ip>:<port>/?auth=<secret>`.
  - **Public internet** — `http://<public-ip>:<port>/?auth=<secret>` (blue).
- The reverse proxy (a child `node` process on `0.0.0.0:<port>`) validates the
  secret, issues a session cookie (default 30 days), and forwards to the
  loopback web UI — including WebSocket upgrades so live updates reach the phone.
- The secret rotates every 30s by default and the QR refreshes to match
  (configurable; `0` disables auto-refresh).
- Click a QR to copy its link; the public QR has an info tooltip.
- A **QR connect** card under Settings → Plugins configures the proxy port,
  session length, and refresh interval.
- English and Chinese UI via DSH's locale service.

## Files

| File | Purpose |
| --- | --- |
| `lib/index.js` | Host half — runs the reverse proxy and the `/__qr/*` state routes. |
| `lib/client.js` | Browser half — the QR button and the settings card. |
| `lib/proxy.cjs` | The auth-gated reverse proxy child process (HTTP + WebSocket). |
| `cordis.patch.yml` | Composition patch that inserts the plugin row. |
| `package.json` | Package metadata (`dsh.bundle` + `dsh.client` manifest). |

## Install

Mount it as a bundle in a DSH profile:

1. In the profile's `package.json`, add `"dsh-plugin-qr-connect": "file:/path/to/dsh-plugin-qr-connect"` to `dependencies`, and add `"dsh-plugin-qr-connect"` to `dsh.profile.bundles`.
2. Run `pnpm install` in the profile directory.
3. Restart `dsh web`.

Defaults live in `cordis.patch.yml` (`port`, `sessionDays`, `refreshSeconds`).
Change them there (or in the profile's own `cordis.patch.yml`) and restart, or
adjust them at runtime from the settings card. The host half serves three
same-origin routes the browser half uses: `GET /__qr/info`,
`POST /__qr/rotate`, and `GET|POST /__qr/config`.

## Requirements

- DSH with the `shell`, `subprocess`, `fs`, and `webServer` services mounted.
- `node` on the DSH host's `PATH`, and `curl` for the public-IP lookup.
- The scanning device must be able to reach the proxy port (a host firewall may
  need an allow rule); the public QR also needs internet reachability
  (port-forwarding).

## Security

The proxy exposes the full agent shell to anyone who can reach the port, gated
only by the 30s secret and the session cookie. Use a short session length and
treat this as a trusted-network convenience, not a hardened remote-access layer.

## License

[MIT](LICENSE)
