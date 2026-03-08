// ===== 状态 =====
const state = {
  mac: null,
  authorized: false,
  taskCounter: 0,
  logExpanded: false,
};

const api = window.electronAPI;

// ===== 日志工具 =====
function log(line, type = 'stdout') {
  const content = document.getElementById('log-content');
  const empty = content.querySelector('.log-empty');
  if (empty) empty.remove();

  const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const el = document.createElement('div');
  el.className = `log-line ${type}`;
  el.innerHTML = `<span class="log-time">${now}</span>${escHtml(line)}`;
  content.appendChild(el);
  content.scrollTop = content.scrollHeight;

  // 更新指示灯
  const ind = document.getElementById('log-indicator');
  if (type === 'error') ind.className = 'log-indicator error';
  else if (type === 'done') ind.className = 'log-indicator done';
  else ind.className = 'log-indicator running';
}

function logInfo(msg)  { log(`ℹ ${msg}`, 'info'); }
function logOk(msg)    { log(`✓ ${msg}`, 'done'); }
function logErr(msg)   { log(`✗ ${msg}`, 'error'); }
function logWarn(msg)  { log(`⚠ ${msg}`, 'stderr'); }

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ===== 命令执行 =====
async function runCmd(cmd, args) {
  const taskId = ++state.taskCounter;
  const label = document.getElementById('log-running-label');
  label.style.display = 'inline';
  document.getElementById('log-indicator').className = 'log-indicator running';
  logInfo(`执行: ${cmd} ${args.join(' ')}`);

  // 注册监听
  api.removeCommandOutputListener();
  api.onCommandOutput(({ taskId: tid, line, type }) => {
    if (tid === taskId) log(line, type);
  });

  const code = await api.runCommand(cmd, args, taskId);

  label.style.display = 'none';
  if (code === 0) {
    document.getElementById('log-indicator').className = 'log-indicator done';
  } else {
    document.getElementById('log-indicator').className = 'log-indicator error';
  }
  return code;
}

// ===== 窗口控制 =====
document.getElementById('btn-minimize').onclick = () => api.minimize();
document.getElementById('btn-maximize').onclick = () => api.maximize();
document.getElementById('btn-close').onclick    = () => api.close();

// ===== 日志面板（右侧收起/展开）=====
const logPanel = document.getElementById('log-panel');
document.getElementById('log-toggle').onclick = () => {
  state.logExpanded = !state.logExpanded;
  // 收起 = collapsed，展开 = 正常宽度
  logPanel.classList.toggle('collapsed', !state.logExpanded);
  document.getElementById('btn-toggle-log').textContent = state.logExpanded ? '\u25c0' : '\u25b6';
};
document.getElementById('btn-clear-log').onclick = (e) => {
  e.stopPropagation();
  const content = document.getElementById('log-content');
  content.innerHTML = '<div class="log-empty">日志区域 — 执行命令后实时显示输出</div>';
  document.getElementById('log-indicator').className = 'log-indicator';
};

function adjustLayout() { /* 右侧布局无需调整主内容区高度 */ }


// ===== 导航切换 =====
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.onclick = () => {
    if (btn.disabled) return; // 锁定状态不允许切换
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const page = btn.dataset.page;
    document.getElementById(`page-${page}`).classList.add('active');
  };
});

// ===== 协议弹窗 =====
async function showAgreement() {
  return new Promise((resolve) => {
    const overlay = document.getElementById('overlay-agreement');
    overlay.style.display = 'flex';
    document.getElementById('btn-agree').onclick = () => {
      overlay.style.display = 'none';
      resolve(true);
    };
    document.getElementById('btn-disagree').onclick = () => {
      api.close();
    };
  });
}

// ===== 授权验证 =====
async function doAuth() {
  const overlay = document.getElementById('overlay-auth');
  overlay.style.display = 'flex';

  try {
    const mac = await api.getMac();
    state.mac = mac;
    document.getElementById('auth-mac').textContent = mac || '无法获取';
    document.getElementById('sidebar-mac').textContent = mac || '-';

    document.getElementById('auth-status').textContent = '正在连接授权服务器...';

    const res = await api.checkAuth(mac);
    document.getElementById('auth-loader').style.display = 'none';

    const resultEl = document.getElementById('auth-result');
    resultEl.style.display = 'block';

    if (res && res.ok && res.record && res.record.authorized) {
      // 授权成功
      resultEl.className = 'auth-result success';
      resultEl.textContent = '✓ 授权验证通过，欢迎使用！';
      document.getElementById('auth-icon').textContent = '✅';
      document.getElementById('auth-icon').classList.remove('spin');
      document.getElementById('auth-title').textContent = '验证成功';
      document.getElementById('auth-status').textContent = `状态: ${res.record.action || 'authorized'}`;

      setTimeout(() => {
        overlay.style.display = 'none';
        showMain();
      }, 1200);

    } else {
      // 未授权
      resultEl.className = 'auth-result fail';
      const action = res?.record?.action || 'unauthorized';
      if (action === 'created') {
        resultEl.innerHTML = `⚠ 您的设备已登记，等待管理员授权。<br><span style="font-size:12px;opacity:.7">MAC: ${mac}</span>`;
      } else {
        resultEl.innerHTML = `✗ 此设备未获授权。<br><span style="font-size:12px;opacity:.7">MAC: ${mac}</span><br><span style="font-size:12px;opacity:.7">请将以上 MAC 地址发送给管理员申请授权。</span>`;
      }
      document.getElementById('auth-icon').textContent = '🔒';
      document.getElementById('auth-icon').classList.remove('spin');
      document.getElementById('auth-title').textContent = '未获授权';
      document.getElementById('auth-status').textContent = '';
      document.getElementById('auth-footer').style.display = 'flex';

      document.getElementById('btn-auth-retry').onclick = () => {
        overlay.style.display = 'none';
        doAuth();
      };
      document.getElementById('btn-auth-exit').onclick = () => api.close();
    }
  } catch (err) {
    document.getElementById('auth-loader').style.display = 'none';
    const resultEl = document.getElementById('auth-result');
    resultEl.style.display = 'block';
    resultEl.className = 'auth-result fail';
    resultEl.textContent = `✗ 网络错误: ${err.message || err}`;
    document.getElementById('auth-icon').textContent = '⚠️';
    document.getElementById('auth-icon').classList.remove('spin');
    document.getElementById('auth-title').textContent = '连接失败';
    document.getElementById('auth-footer').style.display = 'flex';
    document.getElementById('btn-auth-retry').onclick = () => {
      document.getElementById('auth-icon').textContent = '⚡';
      document.getElementById('auth-icon').classList.add('spin');
      document.getElementById('auth-title').textContent = '授权验证中...';
      resultEl.style.display = 'none';
      document.getElementById('auth-loader').style.display = 'block';
      document.getElementById('auth-footer').style.display = 'none';
      doAuth();
    };
    document.getElementById('btn-auth-exit').onclick = () => api.close();
  }
}

function showMain() {
  document.getElementById('main-layout').style.display = 'flex';
  // 自动启动向导：显示主界面后立即开始步骤 1 检测
  setTimeout(() => wizGoTo(1), 300);
}

// ===== 环境检测（向导模式）=====
function setEnvStatus(id, status, text) {
  const el = document.getElementById(id);
  el.className = `env-status ${status}`;
  el.textContent = text;
}

// 向导状态
const wiz = {
  step: 1,          // 当前步骤 1/2/3
  passed: [false, false, false],
};

// 更新步骤指示器和导航按钮
function wizUpdateUI() {
  const s = wiz.step;

  // 更新指示器圆点
  for (let i = 1; i <= 3; i++) {
    const dot = document.getElementById(`wiz-dot-${i}`);
    dot.classList.remove('active', 'done');
    if (i === s) dot.classList.add('active');
    else if (wiz.passed[i - 1]) dot.classList.add('done');
  }
  // 更新连接线
  for (let i = 1; i <= 2; i++) {
    document.getElementById(`wiz-line-${i}`)
      .classList.toggle('done', wiz.passed[i - 1]);
  }

  // 上一步按钮
  document.getElementById('btn-wiz-prev').style.visibility = s > 1 ? 'visible' : 'hidden';

  // 下一步按钮
  const nextBtn = document.getElementById('btn-wiz-next');
  const ok = wiz.passed[s - 1];
  nextBtn.disabled = !ok;
  if (s === 3 && ok) nextBtn.textContent = '✓ 全部完成';
  else nextBtn.textContent = ok ? '下一步 →' : '请先完成安装';
}

// 显示当前步骤面板
function wizShowPanel(step) {
  for (let i = 1; i <= 3; i++) {
    document.getElementById(`wiz-panel-${i}`).style.display = i === step ? 'block' : 'none';
  }
}

// 检测当前步骤
async function wizCheck() {
  const s = wiz.step;
  const nextBtn = document.getElementById('btn-wiz-next');
  nextBtn.disabled = true;
  nextBtn.textContent = '检测中...';

  logInfo(`[步骤 ${s}/3] 环境检测中...`);
  const result = await api.checkEnv();

  if (s === 1) {
    // Node.js
    const ver = result.nodeVer;
    if (!ver) {
      setEnvStatus('status-node', 'fail', '未安装');
      document.getElementById('btn-install-node').style.display = 'inline-flex';
      document.getElementById('btn-uninstall-node').style.display = 'none';
      document.getElementById('btn-uninstall-node-winget').style.display = 'none';
      logErr('Node.js 未安装');
      wiz.passed[0] = false;
    } else if (ver !== 'v22.14.0') {
      setEnvStatus('status-node', 'fail', `${ver} (版本不符)`);
      document.getElementById('btn-install-node').style.display = 'inline-flex';
      document.getElementById('btn-uninstall-node').style.display = 'inline-flex';
      document.getElementById('btn-uninstall-node-winget').style.display = 'inline-flex';
      logWarn(`Node.js 当前版本 ${ver}，需要 v22.14.0`);
      wiz.passed[0] = false;
    } else {
      setEnvStatus('status-node', 'ok', ver);
      document.getElementById('btn-install-node').style.display = 'none';
      document.getElementById('btn-uninstall-node').style.display = 'inline-flex';
      document.getElementById('btn-uninstall-node-winget').style.display = 'inline-flex';
      logOk(`Node.js ${ver} ✓`);
      wiz.passed[0] = true;
    }

  } else if (s === 2) {
    // Git
    const ver = result.gitVer;
    if (!ver) {
      setEnvStatus('status-git', 'fail', '未安装');
      document.getElementById('btn-install-git').style.display = 'inline-flex';
      document.getElementById('btn-uninstall-git').style.display = 'none';
      document.getElementById('btn-uninstall-git-winget').style.display = 'none';
      logErr('Git 未安装');
      wiz.passed[1] = false;
    } else {
      setEnvStatus('status-git', 'ok', ver.replace('git version ', ''));
      document.getElementById('btn-install-git').style.display = 'none';
      document.getElementById('btn-uninstall-git').style.display = 'inline-flex';
      document.getElementById('btn-uninstall-git-winget').style.display = 'inline-flex';
      logOk(`${ver} ✓`);
      wiz.passed[1] = true;
    }

  } else if (s === 3) {
    // OpenClaw
    const ver = result.openclawVer;
    if (!ver) {
      setEnvStatus('status-openclaw', 'fail', '未安装');
      document.getElementById('btn-install-openclaw').style.display = 'inline-flex';
      document.getElementById('btn-uninstall-openclaw').style.display = 'none';
      logErr('OpenClaw CLI 未安装');
      wiz.passed[2] = false;
    } else {
      setEnvStatus('status-openclaw', 'ok', ver);
      document.getElementById('btn-install-openclaw').style.display = 'none';
      document.getElementById('btn-uninstall-openclaw').style.display = 'inline-flex';
      logOk(`OpenClaw ${ver} ✓`);
      wiz.passed[2] = true;
    }
  }

  wizUpdateUI();
}

// 跳转到指定步骤
async function wizGoTo(step) {
  wiz.step = step;
  wizShowPanel(step);
  await wizCheck();
}

// 向导导航按钮
document.getElementById('btn-wiz-next').onclick = async () => {
  if (wiz.step < 3) {
    await wizGoTo(wiz.step + 1);
  } else {
    // 全部完成 - 自动初始化流程
    const nextBtn = document.getElementById('btn-wiz-next');
    const prevBtn = document.getElementById('btn-wiz-prev');
    nextBtn.disabled = true;
    nextBtn.textContent = '初始化中...';
    prevBtn.style.visibility = 'hidden';
    document.getElementById('btn-wiz-recheck').disabled = true;

    // 展开日志面板
    if (!state.logExpanded) {
      state.logExpanded = true;
      logPanel.classList.remove('collapsed');
      document.getElementById('btn-toggle-log').textContent = '◀';
    }

    // 1. 自动运行 openclaw setup（在日志面板中实时显示，auto-yes 自动应答）
    logInfo('🚀 正在自动初始化 OpenClaw（openclaw setup）...');
    const code = await runCmd('openclaw', ['setup']);

    if (code !== 0) {
      logWarn(`⚠ openclaw setup 退出码 ${code}，继续写入默认配置...`);
    }

    // 2. 写入全套默认配置（深度合并，不覆盖 setup 生成的 token 等字段）
    logInfo('📝 正在写入默认配置项...');
    const res = await api.writeDefaultConfig();
    if (res.ok) {
      logOk(`✓ 默认配置已写入: ${res.path}`);
    } else {
      logWarn(`⚠ 配置写入失败: ${res.error}`);
    }

    // 3. 显示快捷操作已移除，直接进入步骤 4
    logOk('🎉 所有环境已就绪！');

    // 4. 解锁「模型配置」和「飞书集成」导航项
    ['nav-model', 'nav-feishu'].forEach(id => {
      const btn = document.getElementById(id);
      btn.disabled = false;
      btn.classList.remove('nav-locked');
      const lock = btn.querySelector('.nav-lock-icon');
      if (lock) lock.remove();
    });

    nextBtn.disabled = false;
    nextBtn.textContent = '✓ 已完成';
    document.getElementById('btn-wiz-recheck').disabled = false;

    // 5. 自动跳转到「模型配置」页
    setTimeout(() => {
      document.getElementById('nav-model').click();
    }, 600);
  }
};

document.getElementById('btn-wiz-prev').onclick = () => wizGoTo(wiz.step - 1);
document.getElementById('btn-wiz-recheck').onclick = () => wizCheck();

// 安装 Node.js
document.getElementById('btn-install-node').onclick = async () => {
  setEnvStatus('status-node', 'checking', '安装中...');
  logInfo('正在通过 winget 安装 Node.js v22.14.0...');
  const code = await runCmd('winget', [
    'install', '--id', 'OpenJS.NodeJS', '-e',
    '--version', '22.14.0',
    '--accept-source-agreements', '--accept-package-agreements',
    '--silent'
  ]);
  if (code === 0) {
    logInfo('正在刷新环境变量...');
    await api.refreshEnv();
    logOk('Node.js 安装完成');
    await wizCheck(); // 安装后自动重检
  } else {
    setEnvStatus('status-node', 'fail', '安装失败');
    logErr('安装失败，请手动安装 Node.js v22.14.0');
  }
};

// 安装 Git
document.getElementById('btn-install-git').onclick = async () => {
  setEnvStatus('status-git', 'checking', '安装中...');
  logInfo('正在通过 winget 安装 Git...');
  const code = await runCmd('winget', [
    'install', '--id', 'Git.Git', '-e',
    '--accept-source-agreements', '--accept-package-agreements',
    '--silent'
  ]);
  if (code === 0) {
    logInfo('正在刷新环境变量...');
    await api.refreshEnv();
    logOk('Git 安装完成');
    logInfo('正在初始化 Git 全局配置...');
    const sysInfo = await api.getSystemInfo();
    await runCmd('git', ['config', '--global', 'user.name',  sysInfo.username]);
    await runCmd('git', ['config', '--global', 'user.email', sysInfo.email]);
    logOk(`Git 已配置：name="${sysInfo.username}"  email="${sysInfo.email}"`);
    await wizCheck(); // 安装后自动重检
  } else {
    setEnvStatus('status-git', 'fail', '安装失败');
    logErr('winget 安装 Git 失败，请访问 https://git-scm.com 手动下载安装');
  }
};

// 安装 OpenClaw（管理员 CMD 窗口）
document.getElementById('btn-install-openclaw').onclick = () => {
  setEnvStatus('status-openclaw', 'checking', '安装中...');
  logInfo('在新管理员 CMD 窗口中运行: npm install -g openclaw@latest');
  logInfo('安装完成后请点击「重新检测」按钮确认结果');
  api.runInTerminal('npm', ['install', '-g', 'openclaw@latest']);
};


// ===== 环境卸载 =====
document.getElementById('btn-uninstall-node-winget').onclick = () => {
  logInfo('在新 CMD 窗口中运行: winget uninstall Node.js');
  api.runInTerminal('winget', [
    'uninstall', '--id', 'OpenJS.NodeJS.LTS', '-e',
    '||', 'winget', 'uninstall', '--id', 'OpenJS.NodeJS', '-e',
  ]);
};
document.getElementById('btn-uninstall-node').onclick = () => {
  logInfo('打开 Windows 已安装应用页面，请搜索 "Node.js" 进行卸载');
  api.openExternal('ms-settings:appsfeatures');
};
document.getElementById('btn-uninstall-git-winget').onclick = () => {
  logInfo('在新 CMD 窗口中运行: winget uninstall Git');
  api.runInTerminal('winget', ['uninstall', '--id', 'Git.Git', '-e']);
};
document.getElementById('btn-uninstall-git').onclick = () => {
  logInfo('打开 Windows 已安装应用页面，请搜索 "Git" 进行卸载');
  api.openExternal('ms-settings:appsfeatures');
};
document.getElementById('btn-uninstall-openclaw').onclick = () => {
  logInfo('在新 CMD 窗口中运行: npm uninstall -g openclaw + 清理 .openclaw 目录');
  api.runInTerminal('npm', ['uninstall', '-g', 'openclaw', '&&', 'echo', '正在清理 .openclaw 目录...', '&&', 'rmdir', '/s', '/q', '%USERPROFILE%\\.openclaw', '&&', 'echo', '.openclaw 目录已清理完成']);
};


// ===== 飞书集成页面 =====

// 官网直达
document.getElementById('btn-feishu-portal').onclick = () => {
  api.openExternal('https://open.feishu.cn/app');
};

// 1. 清理旧数据
document.getElementById('btn-feishu-clean').onclick = async () => {
  logInfo('正在检查 feishu 扩展目录...');
  if (!state.logExpanded) {
    state.logExpanded = true;
    logPanel.classList.remove('collapsed');
    document.getElementById('btn-toggle-log').textContent = '◀';
  }
  const res = await api.removeFeishuDir();
  if (res.error) logErr(`删除失败: ${res.error} (${res.path})`);
  else if (res.removed) logOk(`已删除旧飞书目录: ${res.path}`);
  else logInfo(`未找到旧飞书目录，无需清理 (${res.path})`);
  // 清理完成（无论有没有旧数据），展示步骤 2
  document.getElementById('feishu-step-2').style.display = 'flex';
  document.getElementById('feishu-step-2').scrollIntoView({ behavior: 'smooth' });
};

// 2. 安装飞书插件（新 CMD 窗口）→500ms 后展示步骤 3
document.getElementById('btn-feishu-install').onclick = () => {
  logInfo('在新 CMD 窗口中运行: openclaw plugins install @m1heng-clawd/feishu');
  api.runInTerminal('openclaw', ['plugins', 'install', '@m1heng-clawd/feishu']);
  setTimeout(() => {
    document.getElementById('feishu-step-3').style.display = 'flex';
    document.getElementById('feishu-step-3').scrollIntoView({ behavior: 'smooth' });
  }, 500);
};

// 3. 写入飞书频道配置 → 成功后显示重启网关区块
document.getElementById('btn-feishu-channel-apply').onclick = async () => {
  const appId     = document.getElementById('feishu-appid-input').value.trim();
  const appSecret = document.getElementById('feishu-appsecret-input').value.trim();
  const statusEl  = document.getElementById('feishu-channel-status');
  const btn       = document.getElementById('btn-feishu-channel-apply');

  if (!appId || !appSecret) {
    statusEl.textContent = '⚠ 请填写 App ID 和 App Secret';
    statusEl.style.color = 'var(--warning)';
    return;
  }

  btn.disabled = true;
  btn.textContent = '写入中...';
  statusEl.textContent = '';

  const res = await api.feishuChannelApply(appId, appSecret);
  btn.disabled = false;
  btn.textContent = '✅ 写入配置';

  if (res.ok) {
    statusEl.textContent = `✓ 已写入: ${res.path}`;
    statusEl.style.color = 'var(--success)';
    logOk(`飞书 channels 配置已写入: ${res.path}`);
    // 显示重启网关区块
    document.getElementById('feishu-done-section').style.display = 'flex';
    document.getElementById('feishu-done-section').scrollIntoView({ behavior: 'smooth' });
  } else {
    statusEl.textContent = `✗ 写入失败: ${res.error}`;
    statusEl.style.color = 'var(--danger)';
    logErr(`写入飞书配置失败: ${res.error}`);
  }
};

// 飞书配置完成后启动网关
document.getElementById('btn-feishu-restart-gateway').onclick = () => {
  logInfo('在新 CMD 窗口中运行: openclaw gateway');
  api.runInTerminal('openclaw', ['gateway']);
};

// ===== 模型配置页 =====

// 获取并应用 API Key → 成功后显示重启网关区块
document.getElementById('btn-model-fetch-apikey').onclick = async () => {
  const btn       = document.getElementById('btn-model-fetch-apikey');
  const statusEl  = document.getElementById('model-fetch-status');
  const displayEl = document.getElementById('model-apikey-display');

  btn.disabled = true;
  btn.textContent = '获取中…';
  statusEl.className = 'model-status info';
  statusEl.textContent = '正在从服务器获取 API Key…';

  try {
    const mac = state.mac;
    if (!mac) throw new Error('MAC 地址未获取，请重启应用');

    const res = await api.modelFetchApiKey(mac);
    if (!res.ok || !res.apikey) {
      throw new Error(res.error || '该 MAC 地址暂无分配的 API Key（404）');
    }

    const apiKey = res.apikey;
    // 脱敏展示
    const masked = apiKey.length > 10 ? apiKey.slice(0, 6) + '****' + apiKey.slice(-4) : '****';
    displayEl.textContent = masked;
    statusEl.className = 'model-status info';
    statusEl.textContent = '✓ 已获取 API Key，正在写入 openclaw.json…';

    const applyRes = await api.modelConfigApply(apiKey);
    if (!applyRes.ok) throw new Error('写入失败: ' + applyRes.error);

    statusEl.className = 'model-status ok';
    statusEl.textContent = `✓ 配置已更新：${applyRes.path}`;
    logOk(`模型 API Key 已写入: ${applyRes.path}`);

    // 显示区块，开始自动启动网关
    const section    = document.getElementById('model-restart-section');
    const gatewayTip = document.getElementById('model-gateway-tip');
    const browserTip = document.getElementById('model-browser-tip');
    const openBtn    = document.getElementById('btn-model-open-browser');
    const restartBtn = document.getElementById('btn-model-restart-gateway');

    section.style.display = 'flex';
    section.scrollIntoView({ behavior: 'smooth' });

    // 1. 静默后台启动网关
    logInfo('🚀 正在后台静默启动网关...');
    const gwRes = await api.gatewayStartBg();
    if (gwRes.ok) {
      logOk(`网关已启动 (pid: ${gwRes.pid})`);
    } else {
      logWarn('网关启动失败，将继续尝试读取 Token...');
    }

    // 2. 轮询最多 15 秒等待 token 写入
    gatewayTip.textContent = '✅ 网关已启动，正在等待 Token 就绪...';
    browserTip.style.display = 'block';

    let token = null;
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const tr = await api.gatewayReadToken();
      if (tr.ok && tr.token) { token = tr.token; break; }
    }

    // 3. 打开浏览器
    const openBrowser = () => {
      const url = token
        ? `http://localhost:18789?token=${encodeURIComponent(token)}`
        : 'http://localhost:18789';
      logInfo(`🌐 打开: ${url}`);
      api.openExternal(url);
    };

    if (token) {
      browserTip.textContent = '✅ Token 已就绪，正在打开浏览器...';
      logOk('Token 读取成功，自动打开浏览器');
    } else {
      browserTip.textContent = '⚠ 未读取到 Token，直接打开 localhost:18789';
      logWarn('15s 内未读取到 gateway.auth.token，直接打开首页');
    }
    openBrowser();

    // 4. 显示两个操作按钮
    openBtn.style.display    = 'inline-flex';
    restartBtn.style.display = 'inline-flex';

    openBtn.onclick = openBrowser;
    restartBtn.onclick = async () => {
      restartBtn.disabled = true;
      restartBtn.textContent = '启动中...';
      logInfo('♻️ 重新静默启动网关...');
      const r = await api.gatewayStartBg();
      if (r.ok) logOk(`网关已重新启动 (pid: ${r.pid})`);
      else       logErr('网关重新启动失败');
      restartBtn.disabled = false;
      restartBtn.textContent = '♻️ 重新静默启动网关';
    };

  } catch (err) {
    statusEl.className = 'model-status error';
    statusEl.textContent = `✗ ${err.message}`;
    logErr('获取 API Key 失败: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ 获取并应用';
  }
};





// ===== 启动流程 =====
async function init() {
  const config = await api.getConfig();

  // 1. 协议检查
  if (!config.agreementAccepted) {
    await showAgreement();
    await api.saveConfig({ agreementAccepted: true });
  }

  // 2. 授权验证
  await doAuth();
}

init();
