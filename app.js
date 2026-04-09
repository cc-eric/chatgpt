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
  tailscaleHost: document.getElementById('tailscale-host'),
  accessToken: document.getElementById('access-token'),
  remoteEnabled: document.getElementById('remote-enabled')
};

const state = {
  token: new URLSearchParams(window.location.search).get('token') || '',
  serverHost: '127.0.0.1',
  serverPort: 18789,
  running: false,
  lastRun: '--'
};

function addLog(level, message) {
  const node = logTemplate.content.firstElementChild.cloneNode(true);
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  node.querySelector('.log-time').textContent = time;
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
    fields.autoBrowser.checked ? '--open-browser' : null
  ].filter(Boolean);
}

function renderCommand() {
  commandPreview.textContent = buildRunCommand().join(' \\\n  ');
}

function updateStatusUI() {
  runStatus.textContent = state.running ? '运行中' : '已停止';
  lastRun.textContent = state.lastRun;
  listenAddress.textContent = `${state.serverHost}:${state.serverPort}`;

  const localUrl = `http://127.0.0.1:${state.serverPort}`;
  localUrlNode.textContent = `本地: ${localUrl}`;

  if (fields.remoteEnabled.checked && fields.tailscaleHost.value.trim()) {
    const tokenQuery = fields.accessToken.value.trim() ? `?token=${encodeURIComponent(fields.accessToken.value.trim())}` : '';
    remoteUrlNode.textContent = `远程: http://${fields.tailscaleHost.value.trim()}:${state.serverPort}/${tokenQuery}`;
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
  try {
    const status = await fetchJSON('/api/status');
    state.running = Boolean(status.running);
    state.lastRun = status.lastRun || '--';
    state.serverHost = status.serverHost || '127.0.0.1';
    state.serverPort = status.serverPort || 18789;
    updateStatusUI();
    addLog('info', '状态同步成功。');
  } catch (error) {
    addLog('error', `状态同步失败: ${error.message}`);
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
    command: buildRunCommand().join(' ')
  };

  try {
    const result = await fetchJSON('/api/start', { method: 'POST', body: JSON.stringify(payload) });
    state.running = Boolean(result.running);
    state.lastRun = result.lastRun || new Date().toLocaleString('zh-CN', { hour12: false });
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
document.getElementById('refresh-btn').addEventListener('click', refreshStatus);
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
refreshStatus();
addLog('info', '控制台初始化完成。');
