const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 18789);
const ACCESS_TOKEN = (process.env.ACCESS_TOKEN || '').trim();

const root = __dirname;
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

const runtime = {
  running: false,
  lastRun: '--',
  command: '',
  config: null
};

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
  const normalized = path.normalize(target).replace(/^([.][.][/\\])+/, '');
  return path.join(root, normalized);
}

async function handleApi(req, res, reqUrl) {
  if (req.method === 'GET' && reqUrl.pathname === '/api/status') {
    sendJSON(res, 200, {
      running: runtime.running,
      lastRun: runtime.lastRun,
      command: runtime.command,
      serverHost: HOST,
      serverPort: PORT,
      hasToken: Boolean(ACCESS_TOKEN)
    });
    return;
  }

  if (req.method === 'POST' && reqUrl.pathname === '/api/start') {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};

    runtime.running = true;
    runtime.lastRun = new Date().toLocaleString('zh-CN', { hour12: false });
    runtime.command = body.command || '';
    runtime.config = body;

    sendJSON(res, 200, {
      running: true,
      lastRun: runtime.lastRun,
      message: '服务状态已切换为运行中（UI 控制层）。'
    });
    return;
  }

  if (req.method === 'POST' && reqUrl.pathname === '/api/stop') {
    runtime.running = false;
    sendJSON(res, 200, {
      running: false,
      message: '服务状态已切换为停止。'
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
    if (!filePath.startsWith(root)) {
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
  if (ACCESS_TOKEN) {
    console.log('[openclaw-ui] access token enabled');
  }
});
