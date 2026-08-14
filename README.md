# dsh-plugin-qr-connect

English | [中文](README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) dynamic
Cordis plugin that adds a **QR-code button above the Settings button** in the
sidebar footer. It runs a small auth-gated reverse proxy so a phone on the same
network (or the internet) can scan a QR code and open the web UI securely.

## What it does

- Adds a full-width button (`sidebar.footer.action`, id `qr-connect`) stacked
  **above** the shipped Plugins button.
- Opens a fading panel with **two** QR codes:
  - **Local network** — `http://<lan-ip>:<port>/?auth=<secret>`.
  - **Public internet** — `http://<public-ip>:<port>/?auth=<secret>` (blue).
- The reverse proxy (a child `node` process on `0.0.0.0:<port>`) validates the
  secret, issues a session cookie (default 30 days), and forwards to the
  loopback web UI.
- The secret rotates every 30s by default and the QR refreshes to match
  (configurable; `0` disables auto-refresh).
- Click a QR to copy its link; the public QR has an info tooltip.
- A **QR connect** card under Settings → Plugins configures the proxy port,
  session length, and refresh interval.
- English and Chinese UI via DSH's locale service.

## Files

| File | Purpose |
| --- | --- |
| `host.js` | Host half — value for `code.host` in `cordis_define`. |
| `client.js` | Client half — value for `code.client` in `cordis_define`. |
| `package.json` | Package metadata (`dsh-plugin` keyword + `dsh` manifest). |

## Loading it

This is a **dynamic Cordis plugin**: it runs inside a live DSH session and does
not survive a process restart. Load it from the DSH web GUI (or your agent) with
the `cordis_define` / `cordis_run` flow:

1. Define a new plugin with `code.host` = the full contents of `host.js` and
   `code.client` = the full contents of `client.js` (an `idPrefix` such as
   `qrconn` is enough — the host allocates the final ID).
2. Run the returned package and approve the client half in the UI.

The two `.js` files are the **function bodies** the dynamic runner expects (they
are not standalone Node/browser modules), so pass their contents as-is — do not
`import` them.

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
