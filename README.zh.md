# dsh-plugin-qr-connect

<p align="center">
  <a href="https://github.com/mervyn-teo/dsh-plugin-qr-connect">
    <img src="assets/banner.png" alt="dsh-plugin-qr-connect 横幅 — 扫码即可让任意设备连接到你的 DeepSeek Harness Web UI" width="100%">
  </a>
</p>

[English](README.md) | 中文

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Web
插件：在侧边栏底部「设置」按钮上方添加一个 **二维码按钮**。它运行一个小型、
带鉴权的反向代理，让同一网络（或公网）上的手机扫码后安全地打开 Web UI。它是
一个持久化的 bundle 插件（Host 半边 + 浏览器半边），每次启动都会自动加载。

## 演示

<p align="center">
  <img src="assets/demo-v2.gif" alt="dsh-plugin-qr-connect 演示 — 点击二维码按钮、扫码、连接" width="360">
</p>

## 功能

- 添加一个全宽按钮（`sidebar.footer.action`，id `qr-connect`），堆叠在官方
  「插件」按钮上方。
- 点击后打开一个淡入淡出的面板，显示 **两个** 二维码：
  - **本地网络** — `http://<局域网 IP>:<端口>/?auth=<密钥>`。
  - **公网** — `http://<公网 IP>:<端口>/?auth=<密钥>`（蓝色）。
- 反向代理（一个监听 `0.0.0.0:<端口>` 的 `node` 子进程）校验密钥，签发会话
  Cookie（默认 30 天），然后转发到回环 Web UI —— 包括 WebSocket 升级，使实时
  更新也能同步到手机。
- 密钥默认每 30 秒轮换一次，二维码同步刷新（可配置，`0` 表示关闭自动刷新）。
- 点击二维码复制对应链接；公网二维码带有信息提示（悬浮显示「仅在端口转发后可用」）。
- 在 设置 → 插件 中提供 **QR connect** 配置卡片，可设置代理端口、会话时长、
  刷新间隔。
- 通过 DSH 的 locale 服务支持英文与中文界面。

## 文件

| 文件 | 用途 |
| --- | --- |
| `lib/index.js` | Host 半边 —— 运行反向代理与 `/__qr/*` 状态路由。 |
| `lib/client.js` | 浏览器半边 —— 二维码按钮与配置卡片。 |
| `lib/proxy.cjs` | 带鉴权的反向代理子进程（HTTP + WebSocket）。 |
| `cordis.patch.yml` | 插入插件行的组合补丁。 |
| `package.json` | 包元数据（`dsh.bundle` + `dsh.client` 清单）。 |

## 安装

```bash
dsh plugin --profile web add github:mervyn-teo/dsh-plugin-qr-connect
```

然后重启 `dsh web` —— Host bundle 在启动时加载。

默认配置在 `cordis.patch.yml`（`port`、`sessionDays`、`refreshSeconds`）。可在
那里（或 profile 自带的 `cordis.patch.yml`）修改后重启，或在运行时通过配置卡片
调整。Host 半边提供三个同源路由供浏览器半边使用：`GET /__qr/info`、
`POST /__qr/rotate` 与 `GET|POST /__qr/config`。

## 依赖

- DSH 需要挂载 `subprocess`、`fs`、`webServer` 服务。
- DSH 宿主能访问公网以查询公网 IP（`https://api.ipify.org`）。
- 扫码设备需要能访问代理端口（宿主机防火墙可能需要放行）；公网二维码还需要
  公网可访问（端口转发）。

本地 IP 与公网 IP 的探测在进程内完成（不再依赖 `ip`/`curl`/shell 命令），手动
轮换密钥通过子进程 stdin 通知，因此 Host 半边可在 Windows、macOS、Linux 上运行。

## 安全

该代理会把完整的 agent shell 暴露给任何能访问该端口的设备，仅靠 30 秒密钥和
会话 Cookie 保护。请使用较短的会话时长，将其视为可信网络内的便利工具，而不是
强化的远程访问层。

## 许可证

[MIT](LICENSE)
