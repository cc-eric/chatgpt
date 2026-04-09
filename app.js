const presets = {
  balanced: {
    threads: 8,
    batch: 512,
    label: 'Balanced',
    suggestions: [
      '当前配置适合本地开发与功能验证。',
      '吞吐与稳定性平衡，适合日常调试。',
      '如需更快响应，可切换到 Fast 预设。'
    ]
  },
  fast: {
    threads: 12,
    batch: 1024,
    label: 'Fast',
    suggestions: [
      'Fast 预设更适合演示与低延迟交互。',
      '请确认 CPU 与 GPU 负载仍在可接受范围内。',
      '若温度升高明显，建议降低 batch size。'
    ]
  },
  memory: {
    threads: 6,
    batch: 256,
    label: 'Memory Saver',
    suggestions: [
      '该预设优先降低显存与内存占用。',
      '适合笔记本或共享 GPU 环境。',
      '若仍有 OOM，可继续降低 GPU Layer。'
    ]
  }
};

const commandPreview = document.getElementById('command-preview');
const suggestions = document.getElementById('suggestions');
const runStatus = document.getElementById('run-status');
const lastRun = document.getElementById('last-run');
const healthBadge = document.getElementById('health-badge');
const logOutput = document.getElementById('log-output');
const logTemplate = document.getElementById('log-line-template');

const fields = {
  modelPath: document.getElementById('model-path'),
  servicePort: document.getElementById('service-port'),
  contextSize: document.getElementById('context-size'),
  gpuLayers: document.getElementById('gpu-layers'),
  preset: document.getElementById('preset-select'),
  autoBrowser: document.getElementById('auto-browser')
};

function renderCommand() {
  const preset = presets[fields.preset.value];
  const args = [
    'openclaw serve',
    `--model ${fields.modelPath.value}`,
    `--port ${fields.servicePort.value}`,
    `--ctx-size ${fields.contextSize.value}`,
    `--gpu-layers ${fields.gpuLayers.value}`,
    `--threads ${preset.threads}`,
    `--batch-size ${preset.batch}`,
    fields.autoBrowser.checked ? '--open-browser' : null
  ].filter(Boolean);

  commandPreview.textContent = args.join(' \\\n  ');
  suggestions.innerHTML = preset.suggestions.map((item) => `<li>${item}</li>`).join('');
}

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

function simulateMetrics() {
  const cpu = `${12 + Math.floor(Math.random() * 18)}%`;
  const gpu = `${30 + Math.floor(Math.random() * 28)}%`;
  const memoryUsed = (10 + Math.random() * 6).toFixed(1);
  document.getElementById('cpu-usage').textContent = cpu;
  document.getElementById('gpu-usage').textContent = gpu;
  document.getElementById('memory-usage').textContent = `${memoryUsed} / 32 GB`;
  document.querySelectorAll('.progress span')[0].style.width = cpu;
  document.querySelectorAll('.progress span')[1].style.width = gpu;
  document.querySelectorAll('.progress span')[2].style.width = `${(Number(memoryUsed) / 32) * 100}%`;
}

function validateConfig() {
  const port = Number(fields.servicePort.value);
  const ctx = Number(fields.contextSize.value);
  const gpu = Number(fields.gpuLayers.value);
  const valid = fields.modelPath.value && port >= 1 && port <= 65535 && ctx >= 1024 && gpu >= 0;

  healthBadge.textContent = valid ? '环境就绪' : '配置异常';
  healthBadge.className = `badge ${valid ? 'success' : 'warning'}`;
  return valid;
}

Object.values(fields).forEach((field) => {
  field.addEventListener('input', () => {
    renderCommand();
    validateConfig();
  });
  field.addEventListener('change', renderCommand);
});

document.getElementById('start-btn').addEventListener('click', () => {
  if (!validateConfig()) {
    addLog('warn', '启动失败：请先修正模型路径、端口或上下文参数。');
    return;
  }
  runStatus.textContent = '运行中';
  lastRun.textContent = new Date().toLocaleString('zh-CN', { hour12: false });
  addLog('info', '开始执行 OpenClaw 本地服务启动流程。');
  addLog('success', `已应用 ${presets[fields.preset.value].label} 预设并完成参数校验。`);
  addLog('info', '服务健康检查通过，日志输出与资源监控已联动刷新。');
  simulateMetrics();
});

document.getElementById('stop-btn').addEventListener('click', () => {
  runStatus.textContent = '已停止';
  addLog('warn', '已发送停止信号，等待 OpenClaw 进程退出。');
});

document.getElementById('copy-btn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(commandPreview.textContent);
    addLog('success', '启动命令已复制到剪贴板。');
  } catch {
    addLog('warn', '复制失败：当前环境不支持剪贴板写入。');
  }
});

renderCommand();
validateConfig();
simulateMetrics();
addLog('info', '面板初始化完成，可直接调整参数并启动。');
