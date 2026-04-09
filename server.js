const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 18789);
const ACCESS_TOKEN = (process.env.ACCESS_TOKEN || '').trim();
const OPENCLAW_BIN = process.env.OPENCLAW_BIN || 'openclaw';
const OPENCLAW_MOCK = process.env.OPENCLAW_MOCK === '1';

const root = __dirname;
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

const runtime = {
  running: false,
  lastRun: '--',
  command: '',
  config: null,
  process: null,
  pid: null,
  startedAt: null,
  logs: [],
  seq: 0
};

function pushLog(level, message) {
  runtime.seq += 1;
  runtime.logs.push({ id: runtime.seq, time: new Date().toISOString(), level, message });
  if (runtime.logs.length > 500) {
    runtime.logs = runtime.logs.slice(-500);
  }
}

function sendJSON(res, code, payload) {
  res.writeHead(code, { 'Content-Type': mimeTypes['.json'] });
  res.end(JSON.stringify(payload));
}

function requestAuthorized(reqUrl, reqHeaders) {
  if (!ACCESS_TOKEN) return true;
  const tokenFromHeader = reqHeaders['x-access-token'];
  const tokenFromQuery = reqUrl.searchParams.get('token');
  return tokenFromHeader === ACCESS_TOKEN || tokenFromQuery === ACCESS_TOKEN;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('payload too large'));
      }
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

function safeFilePath(urlPathname) {
  const target = urlPathname === '/' ? '/index.html' : urlPathname;
  const resolved = path.resolve(root, `.${target}`);
  if (!resolved.startsWith(root)) {
    return null;
  }
  return resolved;
}

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return fallback;
  return n;
}

function buildArgs(config) {
  const presetMap = {
    balanced: { threads: 8, batch: 512 },
    fast: { threads: 12, batch: 1024 },
    memory: { threads: 6, batch: 256 }
  };

  const modelPath = String(config.modelPath || '').trim();
  const port = parsePositiveInt(config.servicePort, 8080);
  const ctx = parsePositiveInt(config.contextSize, 8192);
  const gpu = parsePositiveInt(config.gpuLayers, 35);
  const preset = presetMap[config.preset] || presetMap.balanced;

  if (!modelPath) throw new Error('modelPath 不能为空');
  if (port < 1 || port > 65535) throw new Error('servicePort 超出范围');
  if (ctx < 1024) throw new Error('contextSize 过小');

  const args = [
    'serve',
    '--model', modelPath,
    '--port', String(port),
    '--ctx-size', String(ctx),
    '--gpu-layers', String(gpu),
    '--threads', String(preset.threads),
    '--batch-size', String(preset.batch)
  ];

  if (Boolean(config.autoBrowser)) args.push('--open-browser');
  if (Boolean(config.openInternet)) args.push('--allow-internet');
  return args;
}

function cleanupProcessState() {
  runtime.process = null;
  runtime.pid = null;
  runtime.running = false;
  runtime.startedAt = null;
}

function startMockProcess(command) {
  runtime.command = `${command} [mock]`;
  runtime.running = true;
  runtime.lastRun = new Date().toLocaleString('zh-CN', { hour12: false });
  runtime.startedAt = Date.now();
  runtime.pid = `mock-${Date.now()}`;
  pushLog('info', `启动命令: ${runtime.command}`);
  pushLog('info', 'OPENCLAW_MOCK=1，已启动模拟进程。');
}

function attachRuntimeListeners(child) {
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) pushLog('info', text);
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) pushLog('warn', text);
  });

  child.on('close', (code, signal) => {
    pushLog('warn', `进程退出: code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    cleanupProcessState();
  });
}

async function startOpenClaw(config) {
  if (runtime.running) throw new Error('OpenClaw 已在运行中');

  runtime.config = config;
  const args = buildArgs(config);
  const command = `${OPENCLAW_BIN} ${args.join(' ')}`;

  if (OPENCLAW_MOCK) {
    startMockProcess(command);
    return;
  }

  const child = spawn(OPENCLAW_BIN, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env
  });

  await new Promise((resolve, reject) => {
    let settled = false;

    child.once('spawn', () => {
      if (settled) return;
      settled = true;
      runtime.command = command;
      runtime.process = child;
      runtime.running = true;
      runtime.pid = child.pid;
      runtime.startedAt = Date.now();
      runtime.lastRun = new Date().toLocaleString('zh-CN', { hour12: false });
      pushLog('info', `启动命令: ${runtime.command}`);
      attachRuntimeListeners(child);
      resolve();
    });

    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      cleanupProcessState();
      const hint = `请确认 ${OPENCLAW_BIN} 可执行，或设置 OPENCLAW_MOCK=1。`;
      pushLog('error', `进程启动失败: ${err.message}`);
      reject(new Error(`进程启动失败: ${err.message}；${hint}`));
    });
  });
}

function stopOpenClaw() {
  if (OPENCLAW_MOCK) {
    if (!runtime.running) return false;
    pushLog('warn', '模拟进程已停止。');
    cleanupProcessState();
    return true;
  }

  if (!runtime.process || !runtime.running) return false;

  const ok = runtime.process.kill('SIGTERM');
  pushLog(ok ? 'warn' : 'error', ok ? '已发送 SIGTERM 停止进程。' : '发送 SIGTERM 失败。');
  return ok;
}

async function handleApi(req, res, reqUrl) {
  if (req.method === 'GET' && reqUrl.pathname === '/api/status') {
    sendJSON(res, 200, {
      running: runtime.running,
      lastRun: runtime.lastRun,
      command: runtime.command,
      serverHost: HOST,
      serverPort: PORT,
      hasToken: Boolean(ACCESS_TOKEN),
      pid: runtime.pid,
      uptimeSec: runtime.startedAt ? Math.floor((Date.now() - runtime.startedAt) / 1000) : 0
    });
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/logs') {
    const since = Number(reqUrl.searchParams.get('since') || 0);
    const logs = runtime.logs.filter((line) => line.id > since);
    sendJSON(res, 200, { logs, latest: runtime.seq });
    return;
  }

  if (req.method === 'POST' && reqUrl.pathname === '/api/start') {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    await startOpenClaw(body);
    sendJSON(res, 200, {
      running: runtime.running,
      lastRun: runtime.lastRun,
      pid: runtime.pid,
      message: OPENCLAW_MOCK ? '已启动模拟服务。' : 'OpenClaw 进程启动成功。'
    });
    return;
  }

  if (req.method === 'POST' && reqUrl.pathname === '/api/stop') {
    const stopped = stopOpenClaw();
    sendJSON(res, 200, {
      running: runtime.running,
      message: stopped ? '已触发停止流程。' : '当前没有运行中的进程。'
    });
    return;
  }

  sendJSON(res, 404, { error: 'not found' });
}

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (!requestAuthorized(reqUrl, req.headers)) {
      sendJSON(res, 401, {
        error: 'unauthorized',
        message: '缺少或错误的访问 token。请使用 ?token=xxx 或 x-access-token。'
      });
      return;
    }

    if (reqUrl.pathname.startsWith('/api/')) {
      await handleApi(req, res, reqUrl);
      return;
    }

    const filePath = safeFilePath(reqUrl.pathname);
    if (!filePath) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('not found');
        return;
      }

      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (error) {
    sendJSON(res, 500, { error: 'server_error', message: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[openclaw-ui] listening at http://${HOST}:${PORT}`);
  if (ACCESS_TOKEN) console.log('[openclaw-ui] access token enabled');
  if (OPENCLAW_MOCK) console.log('[openclaw-ui] mock mode enabled');
});
