# dsh-plugin-qr-connect

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) dynamic
Cordis plugin that adds a small **QR-code button above the Settings button** in the
sidebar footer. Tap it to show a QR code of the web UI's local network address, so
a phone on the same network can scan it and open the web UI without typing the URL.

## What it does

- Adds a full-width button (`sidebar.footer.action`, `id: qr-connect`) that is
  stacked **above** the shipped Plugins button, both above the Settings row.
- On click, opens a panel that fades in/out with **two** QR codes plus their
  URLs:
  - **Local network** — the machine's primary non-loopback IPv4 address, so a
    phone on the same LAN can reach the web UI (`http://<lan-ip>:<port>/`).
  - **Public internet** — the WAN/public IP (via `api.ipify.org`), so a device
    outside the LAN can reach the host when port-forwarded.
- Each QR is generated entirely client-side with a self-contained encoder
  (byte mode, error-correction level M, auto version, standard masking) — no
  external library and no network call to a QR service.

## Files

| File | Purpose |
| --- | --- |
| `host.js` | Host half — value for `code.host` in `cordis_define`. |
| `client.js` | Client half — value for `code.client` in `cordis_define`. |
| `package.json` | Package metadata (`dsh-plugin` keyword + `dsh` manifest). |

## Loading it

This is a **dynamic Cordis plugin**: it runs inside a live DSH session and does
not survive a process restart. Load it from the DSH web GUI (or your agent) with
the `cordis_define` / `cordis_run` flow, passing the two halves verbatim:

1. In DSH, define a new plugin with `code.host` = the full contents of `host.js`
   and `code.client` = the full contents of `client.js` (an `idPrefix` such as
   `qrconn` is enough — the host allocates the final ID).
2. Run the returned package and approve the client half in the UI.

The two `.js` files are the **function bodies** the dynamic runner expects (they
are not standalone Node/browser modules), so pass their contents as-is — do not
`import` them.

## Requirements

- DSH with the `shell` service mounted (used by the Host half to read
  `ip addr` / `hostname -I`). On Linux and macOS the standard commands are used;
  if neither is available the button falls back to the browser's own host.
- The device that scans the QR must be on the same network as the DSH host, and
  the DSH web server must be reachable on that interface.

## How it works

```
Host  : harness.handle('lan-ip') -> shell.run(ip addr / hostname -I) -> { ip }
Client: button -> host.call('lan-ip') -> URL = protocol + ip + port + pathname
        -> self-contained QR encoder -> SVG rendered in the panel
```

## License

[MIT](LICENSE)
