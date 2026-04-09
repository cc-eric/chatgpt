# OpenClaw 本地/远程控制台

这是一个可直接运行的 OpenClaw 控制台（静态前端 + Node 服务层），默认本地访问地址：

- `http://127.0.0.1:18789`

并支持通过 **Tailscale** 内网远程访问。

## 现在支持什么

- 运行参数编辑、预设切换、命令预览。
- 实际 OpenClaw 子进程生命周期控制：启动 / 停止 / 状态查询。
- 后端日志缓存与前端轮询展示（`/api/logs`）。
- 可选访问鉴权（`ACCESS_TOKEN`）。

## 环境变量

- `HOST`：默认 `127.0.0.1`
- `PORT`：默认 `18789`
- `ACCESS_TOKEN`：可选；设置后请求需携带 token
- `OPENCLAW_BIN`：可选；默认 `openclaw`
- `OPENCLAW_MOCK`：可选；设置为 `1` 时使用模拟进程（便于无 openclaw 环境联调）

## 本地启动（仅本机访问）

```bash
node server.js
```

## Tailscale 远程访问

### 1) 在服务端机器启动（允许远程）

```bash
HOST=0.0.0.0 PORT=18789 ACCESS_TOKEN=your-token node server.js
```

### 2) 在同一 tailnet 设备上访问

- `http://<tailscale-ip>:18789/?token=your-token`
- `http://<magicdns-hostname>:18789/?token=your-token`


## 运行测试

```bash
npm test
```

测试会在 `OPENCLAW_MOCK=1` 下验证：

- token 鉴权（未授权返回 401）
- `/api/status`、`/api/start`、`/api/logs`、`/api/stop` 生命周期流程

## API 示例

```bash
curl -H 'x-access-token: your-token' http://127.0.0.1:18789/api/status
```

```bash
curl -H 'x-access-token: your-token' 'http://127.0.0.1:18789/api/logs?since=0'
```

```bash
curl -X POST -H 'x-access-token: your-token' -H 'Content-Type: application/json' \
  -d '{"modelPath":"./models/openclaw-q4.gguf","servicePort":8080,"contextSize":8192,"gpuLayers":35,"preset":"balanced"}' \
  http://127.0.0.1:18789/api/start
```
