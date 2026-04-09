const presets = {
  balanced: { threads: 8, batch: 512, label: 'Balanced' },
  fast: { threads: 12, batch: 1024, label: 'Fast' },
  memory: { threads: 6, batch: 256, label: 'Memory Saver' }
};

const commandPreview = document.getElementById('command-preview');
const runStatus = document.getElementById('run-status');
const lastRun = document.getElementById('last-run');
const healthBadge = document.getElementById('health-badge');
const listenAddress = document.getElementById('listen-address');
const localUrlNode = document.getElementById('local-url');
const remoteUrlNode = document.getElementById('remote-url');
const logOutput = document.getElementById('log-output');
const logTemplate = document.getElementById('log-line-template');

const fields = {
  modelPath: document.getElementById('model-path'),
  servicePort: document.getElementById('service-port'),
  contextSize: document.getElementById('context-size'),
  gpuLayers: document.getElementById('gpu-layers'),
  preset: document.getElementById('preset-select'),
  autoBrowser: document.getElementById('auto-browser'),
  openInternet: document.getElementById('open-internet'),
  tailscaleHost: document.getElementById('tailscale-host'),
  accessToken: document.getElementById('access-token'),
  remoteEnabled: document.getElementById('remote-enabled')
};

const state = {
  token: new URLSearchParams(window.location.search).get('token') || '',
  serverHost: '127.0.0.1',
  serverPort: 18789,
  running: false,
  pid: null,
  lastRun: '--',
  logCursor: 0
};

function addLog(level, message, time = null) {
  const node = logTemplate.content.firstElementChild.cloneNode(true);
  const logTime = time ? new Date(time) : new Date();
  node.querySelector('.log-time').textContent = logTime.toLocaleTimeString('zh-CN', { hour12: false });
  const levelNode = node.querySelector('.log-level');
  levelNode.textContent = level.toUpperCase();
  levelNode.classList.add(level);
  node.querySelector('.log-message').textContent = message;
  logOutput.appendChild(node);
  logOutput.scrollTop = logOutput.scrollHeight;
}

function buildRunCommand() {
  const preset = presets[fields.preset.value];
  return [
    'openclaw serve',
    `--model ${fields.modelPath.value}`,
    `--port ${fields.servicePort.value}`,
    `--ctx-size ${fields.contextSize.value}`,
    `--gpu-layers ${fields.gpuLayers.value}`,
    `--threads ${preset.threads}`,
    `--batch-size ${preset.batch}`,
    fields.autoBrowser.checked ? '--open-browser' : null,
    fields.openInternet.checked ? '--allow-internet' : null
  ].filter(Boolean);
}

function renderCommand() {
  commandPreview.textContent = buildRunCommand().join(' \\\n  ');
}

function updateStatusUI() {
  runStatus.textContent = state.running ? `运行中 (pid: ${state.pid ?? '-'})` : '已停止';
  lastRun.textContent = state.lastRun;
  listenAddress.textContent = `${state.serverHost}:${state.serverPort}`;

  const localUrl = `http://127.0.0.1:${state.serverPort}`;
  localUrlNode.textContent = `本地: ${localUrl}`;

  if (fields.remoteEnabled.checked && fields.tailscaleHost.value.trim()) {
    const token = fields.accessToken.value.trim();
    const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';
    remoteUrlNode.textContent = `远程: http://${fields.tailscaleHost.value.trim()}:${state.serverPort}${tokenQuery}`;
  } else {
    remoteUrlNode.textContent = '远程: 未配置';
  }
}

function validateConfig() {
  const port = Number(fields.servicePort.value);
  const ctx = Number(fields.contextSize.value);
  const gpu = Number(fields.gpuLayers.value);
  const valid = fields.modelPath.value.trim() && port >= 1 && port <= 65535 && ctx >= 1024 && gpu >= 0;

  healthBadge.textContent = valid ? '参数有效' : '参数异常';
  healthBadge.className = `badge ${valid ? 'success' : 'danger'}`;
  return valid;
}

function authHeaders() {
  const token = fields.accessToken.value.trim() || state.token;
  return token ? { 'x-access-token': token } : {};
}

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json();
}

async function refreshStatus() {
  const status = await fetchJSON('/api/status');
  state.running = Boolean(status.running);
  state.lastRun = status.lastRun || '--';
  state.serverHost = status.serverHost || '127.0.0.1';
  state.serverPort = status.serverPort || 18789;
  state.pid = status.pid || null;
  updateStatusUI();
}

async function pullLogs() {
  try {
    const data = await fetchJSON(`/api/logs?since=${state.logCursor}`);
    for (const line of data.logs || []) {
      addLog(line.level || 'info', line.message || '', line.time || null);
    }
    state.logCursor = data.latest || state.logCursor;
  } catch (error) {
    addLog('error', `日志同步失败: ${error.message}`);
  }
}

async function startService() {
  if (!validateConfig()) {
    addLog('warn', '启动失败：请先修正参数。');
    return;
  }

  const payload = {
    modelPath: fields.modelPath.value.trim(),
    servicePort: Number(fields.servicePort.value),
    contextSize: Number(fields.contextSize.value),
    gpuLayers: Number(fields.gpuLayers.value),
    preset: fields.preset.value,
    autoBrowser: fields.autoBrowser.checked,
    openInternet: fields.openInternet.checked
  };

  try {
    const result = await fetchJSON('/api/start', { method: 'POST', body: JSON.stringify(payload) });
    state.running = Boolean(result.running);
    state.lastRun = result.lastRun || new Date().toLocaleString('zh-CN', { hour12: false });
    state.pid = result.pid || null;
    updateStatusUI();
    addLog('success', result.message || 'OpenClaw 已启动。');
  } catch (error) {
    addLog('error', `启动失败: ${error.message}`);
  }
}

async function stopService() {
  try {
    const result = await fetchJSON('/api/stop', { method: 'POST' });
    state.running = Boolean(result.running);
    updateStatusUI();
    addLog('warn', result.message || 'OpenClaw 已停止。');
  } catch (error) {
    addLog('error', `停止失败: ${error.message}`);
  }
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    addLog('success', successMessage);
  } catch {
    addLog('warn', '复制失败：当前环境不支持剪贴板写入。');
  }
}

Object.values(fields).forEach((field) => {
  field.addEventListener('input', () => {
    renderCommand();
    validateConfig();
    updateStatusUI();
  });
});

document.getElementById('start-btn').addEventListener('click', startService);
document.getElementById('stop-btn').addEventListener('click', stopService);
document.getElementById('refresh-btn').addEventListener('click', async () => {
  try {
    await refreshStatus();
  } catch (error) {
    addLog('error', `状态同步失败: ${error.message}`);
  }
});
document.getElementById('copy-btn').addEventListener('click', () => {
  copyText(commandPreview.textContent, '启动命令已复制。');
});
document.getElementById('copy-url-btn').addEventListener('click', () => {
  const remote = remoteUrlNode.textContent.replace('远程: ', '').trim();
  const local = localUrlNode.textContent.replace('本地: ', '').trim();
  const target = remote && remote !== '未配置' ? remote : local;
  copyText(target, '访问地址已复制。');
});

renderCommand();
validateConfig();
updateStatusUI();
refreshStatus().catch((error) => addLog('error', `初始化失败: ${error.message}`));
pullLogs();
setInterval(pullLogs, 2000);
setInterval(() => {
  refreshStatus().catch(() => {});
}, 3000);
addLog('info', '控制台初始化完成。');
