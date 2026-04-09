# OpenClaw 本地/远程控制台

这是一个可直接运行的 OpenClaw 控制台（静态前端 + 内置 Node 服务层），默认本地访问地址为：

- `http://127.0.0.1:18789`

并支持通过 **Tailscale** 内网远程访问。

## 功能

- 运行参数编辑、预设切换、命令预览。
- 启动/停止控制与状态查询 API（`/api/start`、`/api/stop`、`/api/status`）。
- 远程访问入口提示（Tailscale 地址 + 可选 token）。
- 可选访问鉴权（`ACCESS_TOKEN`）。

## 本地启动（仅本机访问）

```bash
node server.js
```

启动后访问：`http://127.0.0.1:18789`

## Tailscale 远程访问

### 1) 在服务端机器上启动（允许远程）

```bash
HOST=0.0.0.0 PORT=18789 ACCESS_TOKEN=your-token node server.js
```

### 2) 在已加入同一 tailnet 的设备上访问

使用以下任一地址：

- `http://<tailscale-ip>:18789/?token=your-token`
- `http://<magicdns-hostname>:18789/?token=your-token`

> 建议开启 `ACCESS_TOKEN`，避免 tailnet 内误访问。

## API 示例

```bash
curl -H 'x-access-token: your-token' http://127.0.0.1:18789/api/status
```

```bash
curl -X POST -H 'x-access-token: your-token' -H 'Content-Type: application/json' \
  -d '{"command":"openclaw serve --model ./models/openclaw-q4.gguf"}' \
  http://127.0.0.1:18789/api/start
```
