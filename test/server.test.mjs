import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const HOST = '127.0.0.1';
const PORT = 18791;
const TOKEN = 'test-token';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServerReady(host, port, token, maxTry = 20) {
  for (let i = 0; i < maxTry; i += 1) {
    try {
      const res = await fetch(`http://${host}:${port}/api/status`, {
        headers: { 'x-access-token': token }
      });
      if (res.ok) return;
    } catch {
      // retry
    }
    await wait(200);
  }
  throw new Error('server not ready in time');
}

function spawnServer({ port, mock, bin = 'openclaw', localBindPort }) {
  return spawn('node', ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST,
      PORT: String(port),
      ACCESS_TOKEN: TOKEN,
      OPENCLAW_MOCK: mock ? '1' : '0',
      OPENCLAW_BIN: bin,
      LOCAL_BIND_PORT: String(localBindPort || port + 200)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

test('server auth + lifecycle + logs api', async (t) => {
  const localBindPort = 18991;
  const child = spawnServer({ port: PORT, mock: true, localBindPort });

  t.after(() => {
    child.kill('SIGTERM');
  });

  await waitForServerReady(HOST, PORT, TOKEN);

  const unauthorized = await fetch(`http://${HOST}:${PORT}/api/status`);
  assert.equal(unauthorized.status, 401);

  const status = await fetch(`http://${HOST}:${PORT}/api/status`, {
    headers: { 'x-access-token': TOKEN }
  });
  assert.equal(status.status, 200);
  const statusBody = await status.json();
  assert.equal(statusBody.running, false);
  assert.equal(statusBody.localAccessUrl, `http://127.0.0.1:${localBindPort}`);

  const start = await fetch(`http://${HOST}:${PORT}/api/start`, {
    method: 'POST',
    headers: {
      'x-access-token': TOKEN,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      modelPath: './models/openclaw-q4.gguf',
      servicePort: 8080,
      contextSize: 8192,
      gpuLayers: 35,
      preset: 'balanced',
      openInternet: true
    })
  });

  assert.equal(start.status, 200);
  const startBody = await start.json();
  assert.equal(startBody.running, true);

  const statusAfterStart = await fetch(`http://${HOST}:${PORT}/api/status`, {
    headers: { 'x-access-token': TOKEN }
  });
  assert.equal(statusAfterStart.status, 200);
  const statusAfterStartBody = await statusAfterStart.json();
  assert.match(statusAfterStartBody.command, /--allow-internet/);

  const logs = await fetch(`http://${HOST}:${PORT}/api/logs?since=0`, {
    headers: { 'x-access-token': TOKEN }
  });
  assert.equal(logs.status, 200);
  const logsBody = await logs.json();
  assert.ok(logsBody.logs.length > 0);

  const stop = await fetch(`http://${HOST}:${PORT}/api/stop`, {
    method: 'POST',
    headers: { 'x-access-token': TOKEN }
  });
  assert.equal(stop.status, 200);
  const stopBody = await stop.json();
  assert.equal(stopBody.running, false);
});

test('start api returns 500 when binary is missing (no false success)', async (t) => {
  const port = 18792;
  const child = spawnServer({ port, mock: false, bin: '__definitely_missing_openclaw__', localBindPort: 18992 });

  t.after(() => {
    child.kill('SIGTERM');
  });

  await waitForServerReady(HOST, port, TOKEN);

  const start = await fetch(`http://${HOST}:${port}/api/start`, {
    method: 'POST',
    headers: {
      'x-access-token': TOKEN,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      modelPath: './models/openclaw-q4.gguf',
      servicePort: 8080,
      contextSize: 8192,
      gpuLayers: 35,
      preset: 'balanced'
    })
  });

  assert.equal(start.status, 500);
  const body = await start.json();
  assert.match(body.message, /进程启动失败/);
});
