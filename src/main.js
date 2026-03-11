const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { getMacAddress } = require('./utils/macAddr');
const { refreshEnvPath, runCommand, checkNode, checkGit, checkOpenclaw, checkWinget, installWinget, installNodeFallback, installGitFallback, installOpenclawFallback, installVCRedistFallback } = require('./utils/sysCheck');

// 配置文件路径（延迟获取，避免 app 未就绪时调用）
function getConfigPath() {
  return path.join(app.getPath('userData'), 'app-config.json');
}

function loadConfig() {
  try {
    const p = getConfigPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch {}
  return {};
}

function saveConfig(data) {
  try {
    const existing = loadConfig();
    fs.writeFileSync(getConfigPath(), JSON.stringify({ ...existing, ...data }, null, 2));
  } catch {}
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 650,
    frame: false,
    transparent: false,
    backgroundColor: '#0d1117',
    icon: path.join(__dirname, '../assets/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ===================== IPC 处理器 =====================

// 窗口控制
ipcMain.on('win-minimize', () => mainWindow?.minimize());
ipcMain.on('win-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('win-close', () => app.quit());

// 读取配置
ipcMain.handle('get-config', () => loadConfig());

// 保存配置
ipcMain.handle('save-config', (_, data) => {
  saveConfig(data);
  return true;
});

// 获取 MAC 地址
ipcMain.handle('get-mac', () => getMacAddress());


// 环境检测
ipcMain.handle('check-env', async () => {
  const [nodeVer, gitVer, openclawVer] = await Promise.all([
    checkNode(), checkGit(), checkOpenclaw()
  ]);
  const hasWinget = checkWinget();
  return { nodeVer, gitVer, openclawVer, hasWinget };
});

// Fallback 安装 winget（流式日志）
ipcMain.handle('install-winget', async (event, taskId) => {
  const code = await installWinget((line, type) => {
    event.sender.send('command-output', { taskId, line, type });
  });
  return code;
});

// Fallback 安装 Node.js（流式日志）
ipcMain.handle('install-node-fallback', async (event, taskId) => {
  const code = await installNodeFallback((line, type) => {
    event.sender.send('command-output', { taskId, line, type });
  });
  return code;
});

// Fallback 安装 Git（流式日志）
ipcMain.handle('install-git-fallback', async (event, taskId) => {
  const code = await installGitFallback((line, type) => {
    event.sender.send('command-output', { taskId, line, type });
  });
  return code;
});

// Fallback 安装 OpenClaw（流式日志）
ipcMain.handle('install-openclaw-fallback', async (event, taskId) => {
  const code = await installOpenclawFallback((line, type) => {
    event.sender.send('command-output', { taskId, line, type });
  });
  return code;
});

// Fallback 安装 VCRedist（流式日志）
ipcMain.handle('install-vcredist-fallback', async (event, taskId) => {
  const code = await installVCRedistFallback((line, type) => {
    event.sender.send('command-output', { taskId, line, type });
  });
  return code;
});

// 执行命令（实时流式输出）
ipcMain.handle('run-command', async (event, cmd, args, taskId) => {
  await refreshEnvPath(); // 先刷新 PATH
  const code = await runCommand(cmd, args, (line, type) => {
    // 实时推送到渲染进程
    event.sender.send('command-output', { taskId, line, type });
  });
  return code;
});

// 刷新环境变量
ipcMain.handle('refresh-env', async () => {
  const path = await refreshEnvPath();
  return path;
});

// 读取 openclaw config
ipcMain.handle('openclaw-config-get', async (event, keyPath) => {
  let output = '';
  const args = keyPath ? ['config', 'get', keyPath] : ['config', 'get'];
  await runCommand('openclaw', args, (line) => { output += line + '\n'; });
  return output.trim();
});

// 设置 openclaw config
ipcMain.handle('openclaw-config-set', async (event, keyPath, value) => {
  let output = '';
  await runCommand('openclaw', ['config', 'set', keyPath, value], (line) => { output += line + '\n'; });
  return output.trim();
});

// 打开外部链接
ipcMain.on('open-external', (_, url) => shell.openExternal(url));

// 获取系统信息（用户名、主机名）
ipcMain.handle('get-system-info', () => {
  const username = os.userInfo().username;
  const hostname = os.hostname();
  return {
    username,
    hostname,
    email: `${username}@${hostname}.local`,
  };
});

// 在新 CMD 窗口中以管理员权限运行交互式命令（命令完成后窗口保持不关闭）
ipcMain.handle('run-in-terminal', async (_, cmd, args) => {
  // 拼接完整命令，先切换代码页到 UTF-8 避免中文乱码
  const innerCmd = ['chcp 65001', [cmd, ...args].join(' ')].join(' && ');

  // VBScript 字符串中双引号用 "" 转义
  const escapedForVbs = innerCmd.replace(/"/g, '""');

  const vbsContent = [
    'Set UAC = CreateObject("Shell.Application")',
    `UAC.ShellExecute "cmd.exe", "/K ${escapedForVbs}", "", "runas", 1`,
  ].join('\r\n');

  // 以 UTF-16 LE + BOM 写入，wscript.exe 原生支持所有 Unicode 字符（含中文）
  const tmpPath = path.join(os.tmpdir(), `oc-admin-${Date.now()}.vbs`);
  fs.writeFileSync(tmpPath, Buffer.from('\ufeff' + vbsContent, 'utf16le'));

  const proc = require('child_process').spawn('wscript.exe', [tmpPath], {
    detached: true,
    shell: false,
    stdio: 'ignore',
    windowsHide: true,
  });
  proc.unref();

  // 5 秒后清理临时文件
  setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 5000);
  return true;
});


// 检测并删除飞书扩展目录
ipcMain.handle('remove-feishu-dir', async () => {
  const feishuDir = path.join(os.homedir(), '.openclaw', 'extensions', 'feishu');
  try {
    if (fs.existsSync(feishuDir)) {
      fs.rmSync(feishuDir, { recursive: true, force: true });
      return { removed: true, path: feishuDir };
    }
    return { removed: false, path: feishuDir };
  } catch (e) {
    return { removed: false, error: e.message, path: feishuDir };
  }
});

// 检测并删除整个 OpenClaw 隐藏配置/缓存目录
ipcMain.handle('remove-openclaw-dir', async () => {
  const rootDir = path.join(os.homedir(), '.openclaw');
  try {
    if (fs.existsSync(rootDir)) {
      fs.rmSync(rootDir, { recursive: true, force: true });
      return { removed: true, path: rootDir };
    }
    return { removed: false, path: rootDir };
  } catch (e) {
    return { removed: false, error: e.message, path: rootDir };
  }
});

// 卸载自身
ipcMain.handle('uninstall-app', async () => {
  // electron-builder (NSIS) 默认在安装目录生成 Uninstall OpenClaw Help.exe
  const exePath = app.getPath('exe');
  const installDir = path.dirname(exePath);
  const uninstallerPath = path.join(installDir, 'Uninstall OpenClaw Help.exe');

  if (fs.existsSync(uninstallerPath)) {
    require('child_process').spawn(uninstallerPath, [], {
      detached: true,
      stdio: 'ignore'
    }).unref();
    app.quit();
    return { ok: true };
  } else {
    // 可能是开发环境，或者绿色版
    return { ok: false, error: '未找到卸载程序：' + uninstallerPath };
  }
});

// ===================== 模型配置 IPC =====================

// openclaw.json 的路径
function getOpenclawConfigPath() {
  return path.join(os.homedir(), '.openclaw', 'openclaw.json');
}

// 读取 openclaw.json
ipcMain.handle('model-config-read', () => {
  try {
    const p = getOpenclawConfigPath();
    if (!fs.existsSync(p)) return { ok: false, error: '文件不存在: ' + p };
    const raw = fs.readFileSync(p, 'utf8');
    return { ok: true, content: raw, path: p };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// 保存 openclaw.json 的全部内容
ipcMain.handle('model-config-write', (_, content) => {
  try {
    const p = getOpenclawConfigPath();
    fs.writeFileSync(p, content, 'utf8');
    return { ok: true, path: p };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// 写入飞书 channels 配置
ipcMain.handle('feishu-channel-apply', (_, appId, appSecret) => {
  try {
    const p = getOpenclawConfigPath();
    let cfg = {};
    if (fs.existsSync(p)) {
      try { cfg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
    }

    if (!cfg.channels) cfg.channels = {};
    cfg.channels.feishu = {
      enabled: true,
      appId,
      appSecret,
      connectionMode: 'websocket',
      domain: 'feishu',
      groupPolicy: 'open',
      dmPolicy: 'open',
      allowFrom: ['*'],
    };

    fs.writeFileSync(p, JSON.stringify(cfg, null, 4), 'utf8');
    return { ok: true, path: p };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ===================== 写入默认配置 IPC =====================

/**
 * 深度合并：src 的字段仅在 target 中不存在时才写入（不覆盖已有值）
 */
function deepMergeDefaults(target, src) {
  for (const key of Object.keys(src)) {
    if (!(key in target)) {
      target[key] = src[key];
    } else if (
      typeof src[key] === 'object' && src[key] !== null &&
      !Array.isArray(src[key]) &&
      typeof target[key] === 'object' && target[key] !== null
    ) {
      deepMergeDefaults(target[key], src[key]);
    }
  }
  return target;
}

// ===================== 网关 =====================

// 读取 openclaw.json 中的 gateway.auth.token
ipcMain.handle('gateway-read-token', () => {
  try {
    const p = getOpenclawConfigPath();
    if (!fs.existsSync(p)) return { ok: false, error: '配置文件不存在' };
    const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
    const token = cfg?.gateway?.auth?.token || null;
    return { ok: true, token };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ===================== 写入默认配置 IPC =====================

ipcMain.handle('write-default-config', () => {
  try {
    const p = getOpenclawConfigPath();
    let cfg = {};
    if (fs.existsSync(p)) {
      try { cfg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
    }

    // 全套默认配置（仅补全缺失字段，不覆盖 setup 已生成内容）
    const defaults = {
      agents: {
        defaults: {
          workspace: path.join(os.homedir(), '.openclaw', 'workspace'),
          compaction: { mode: 'safeguard' },
          maxConcurrent: 4,
          subagents: { maxConcurrent: 8 },
        },
      },
      tools: { profile: 'messaging' },
      messages: { ackReactionScope: 'group-mentions' },
      commands: {
        native: 'auto',
        nativeSkills: 'auto',
        restart: true,
        ownerDisplay: 'raw',
      },
      session: { dmScope: 'per-channel-peer' },
      gateway: {
        port: 18789,
        mode: 'local',
        bind: 'loopback',
        tailscale: { mode: 'off', resetOnExit: false },
        nodes: {
          denyCommands: [
            'camera.snap', 'camera.clip', 'screen.record',
            'contacts.add', 'calendar.add', 'reminders.add', 'sms.send',
          ],
        },
      },
    };

    deepMergeDefaults(cfg, defaults);

    fs.writeFileSync(p, JSON.stringify(cfg, null, 4), 'utf8');
    return { ok: true, path: p };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
