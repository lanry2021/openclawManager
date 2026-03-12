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


// ===== 主流程初始化 =====
function showMain() {
  document.getElementById('main-layout').style.display = 'flex';
  // 显示主界面后立即进行环境检测
  setTimeout(() => checkEnvStatus(), 300);
}

// ===== 环境状态与检测 =====
const envState = {
  hasWinget: false,
  nodeOk: false,
  gitOk: false,
  openclawOk: false,
  vcRedistOk: false,
};

// 后台检测环境组件状态，自动切换视图
async function checkEnvStatus() {
  const btnRecheck = document.getElementById('btn-wiz-recheck');
  const btnRecheck2 = document.getElementById('btn-wiz-recheck-2');
  if (btnRecheck) btnRecheck.disabled = true;
  if (btnRecheck2) btnRecheck2.disabled = true;

  logInfo('[系统] 正在进行环境自检...');
  const result = await api.checkEnv();
  
  envState.hasWinget = !!result.hasWinget;
  
  // Node.js
  const nv = result.nodeVer;
  envState.nodeOk = !!nv;
  if (nv) {
    const major = parseInt(nv.replace(/^v/, ''), 10);
    if (major < 22) logWarn(`Node.js ${nv} 版本较低，建议升级到 v22+`);
    else logOk(`Node.js ${nv} ✓`);
    document.getElementById('badge-node').style.opacity = '1';
  } else {
    document.getElementById('badge-node').style.opacity = '0.5';
  }

  // Git
  const gv = result.gitVer;
  envState.gitOk = !!gv;
  if (gv) {
    logOk(`${gv.replace('git version ', '')} ✓`);
    document.getElementById('badge-git').style.opacity = '1';
  } else {
    document.getElementById('badge-git').style.opacity = '0.5';
  }

  // OpenClaw
  const ov = result.openclawVer;
  envState.openclawOk = !!ov;
  if (ov) {
    logOk(`OpenClaw ${ov} ✓`);
    document.getElementById('badge-openclaw').style.opacity = '1';
  } else {
    document.getElementById('badge-openclaw').style.opacity = '0.5';
  }

  // VC Redist
  const vcrv = result.vcRedistVer;
  envState.vcRedistOk = !!vcrv;
  if (vcrv) {
    logOk(`C++ Redist ${vcrv} ✓`);
    document.getElementById('badge-vcredist').style.opacity = '1';
  } else {
    document.getElementById('badge-vcredist').style.opacity = '0.5';
  }

  // 视图切换
  const allOk = envState.nodeOk && envState.gitOk && envState.openclawOk && envState.vcRedistOk;
  
  document.getElementById('env-view-unready').style.display = allOk ? 'none' : 'flex';
  document.getElementById('env-view-ready').style.display = allOk ? 'block' : 'none';

  if (allOk) {
    logOk('[系统] 所有运行依赖组件均就绪');
    ['nav-feishu'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('nav-locked');
        const lock = btn.querySelector('.nav-lock-icon');
        if (lock) lock.remove();
      }
    });
  } else {
    logWarn('[系统] 环境不完整，请点击"一键初始化"');
  }

  if (btnRecheck) btnRecheck.disabled = false;
  if (btnRecheck2) btnRecheck2.disabled = false;
}

// 供界面按钮重新获取状态
document.getElementById('btn-wiz-recheck').onclick = () => checkEnvStatus();
document.getElementById('btn-wiz-recheck-2').onclick = () => checkEnvStatus();

// ===== 辅助：设置 fallback 流式日志监听 =====
function setupFallbackListeners() {
  const taskId = ++state.taskCounter;
  const label = document.getElementById('log-running-label');
  label.style.display = 'inline';
  document.getElementById('log-indicator').className = 'log-indicator running';
  api.removeCommandOutputListener();
  api.onCommandOutput(({ taskId: tid, line, type }) => {
    if (tid === taskId) log(line, type);
  });
  return { taskId, label };
}

// ===== 辅助：确保 winget 可用（不可用则自动安装） =====
async function ensureWinget() {
  if (envState.hasWinget) return true;
  logInfo('⚙ 检测到系统未安装 winget，正在自动安装...');
  const { taskId, label } = setupFallbackListeners();
  const code = await api.installWinget(taskId);
  label.style.display = 'none';
  if (code === 0) {
    envState.hasWinget = true;
    logOk('winget 安装成功！');
    return true;
  }
  logWarn('winget 安装失败，将使用备用方案（直接下载安装包）');
  return false;
}

// =============== 一键部署逻辑 ===============

async function installNodeTask() {
  logInfo('--- 开始部署 Node.js ---');
  logInfo('正在使用安装包模式部署 Node.js...');
  const { taskId, label } = setupFallbackListeners();
  const code = await api.installNodeFallback(taskId);
  label.style.display = 'none';

  if (code === 0) {
    await api.refreshEnv();
    logOk('Node.js 安装完成');
    
    logInfo('正在初始化 npm 全局镜像源...');
    await runCmd('npm', ['config', 'set', 'registry', 'https://registry.npmmirror.com']);
    logOk('npm 镜像源已配置为淘宝镜像');
    
    return true;
  }
  logErr('安装 Node.js 失败');
  return false;
}

async function installGitTask() {
  logInfo('--- 开始部署 Git ---');
  logInfo('正在使用安装包模式部署 Git...');
  const { taskId, label } = setupFallbackListeners();
  const code = await api.installGitFallback(taskId);
  label.style.display = 'none';

  if (code === 0) {
    await api.refreshEnv();
    logOk('Git 安装完成');
    logInfo('正在初始化 Git 全局配置...');
    const sysInfo = await api.getSystemInfo();
    await runCmd('git', ['config', '--global', 'user.name',  sysInfo.username]);
    await runCmd('git', ['config', '--global', 'user.email', sysInfo.email]);
    
    // 配置国内镜像加速 Github 的 Http Clone (解决 libsignal-node 等子依赖拉取失败)
    await runCmd('git', ['config', '--global', 'url.https://hub.gitmirror.com/https://github.com/.insteadOf', 'https://github.com/']);
    await runCmd('git', ['config', '--global', 'url.https://hub.gitmirror.com/https://github.com/.insteadOf', 'git@github.com:']);
    await runCmd('git', ['config', '--global', 'url.https://hub.gitmirror.com/https://github.com/.insteadOf', 'ssh://git@github.com/']);
    
    logOk('Git 已配置 (已启用 GitHub 镜像加速)');
    return true;
  }
  logErr('安装 Git 失败');
  return false;
}

async function installVCRedistTask() {
  logInfo('--- 开始部署 微软 C++ 运行库 ---');
  logInfo('为了防止本地大模型缺少底层依赖崩溃，正在安装 VC Redist...');
  const { taskId, label } = setupFallbackListeners();
  const code = await api.installVCRedistFallback(taskId);
  label.style.display = 'none';

  if (code === 0) {
    logOk('微软 C++ 运行库 安装完成');
    return true;
  }
  if (code === 2) {
    // 注册表检测已安装，静默跳过即可
    return true;
  }
  logWarn('安装 VCRedist 失败或被拒绝，可能会影响包含本地源码编译的组件！');
  // VC Redist 失败不应该阻塞整个流程，因为用户可能不需要本地大模型
  return true; 
}

async function installOpenclawTask() {
  logInfo('--- 开始部署 OpenClaw ---');
  const { taskId, label } = setupFallbackListeners();
  const code = await api.installOpenclawFallback(taskId);
  label.style.display = 'none';

  if (code === 0) {
    logOk('OpenClaw 安装完成');
    return true;
  }
  
  // 如果非0退出码，但检测到 OpenClaw 已安装成功，说明是可选依赖编译失败，不拦截部署进度
  const envCheck = await api.checkEnv();
  if (envCheck && envCheck.openclawVer) {
    logWarn(`OpenClaw 核心程序已安装成功，但安装过程产生了警告或部分组件编译失败（退出码: ${code}）。一般不影响主功能使用。`);
    return true;
  }
  
  logErr('安装 OpenClaw 失败');
  return false;
}

// 绑定一键部署大按钮
document.getElementById('btn-deploy-all').onclick = async () => {
  const btn = document.getElementById('btn-deploy-all');
  const progContainer = document.getElementById('deploy-progress-container');
  const progText = document.getElementById('deploy-progress-text');
  
  btn.disabled = true;
  progContainer.style.display = 'flex';
  
  // 确保日志面板打开
  if (!state.logExpanded) {
    state.logExpanded = true;
    logPanel.classList.remove('collapsed');
    document.getElementById('btn-toggle-log').textContent = '◀';
  }

  logInfo('========== 开始一键部署环境 ==========');

  try {

    // 1. Node
    if (!envState.nodeOk) {
      progText.textContent = '进度 1/3 (安装 Node.js)...';
      const ok = await installNodeTask();
      if (!ok) throw new Error('Node.js 部署中断');
    }

    // 2. Git
    if (!envState.gitOk) {
      progText.textContent = '进度 2/3 (安装 Git)...';
      const ok = await installGitTask();
      if (!ok) throw new Error('Git 部署中断');
    }

    // 2.5 VC Redist (Silent)
    progText.textContent = '进度 2.5/3 (补充 C++ 运行环境)...';
    await installVCRedistTask();

    // 3. OpenClaw
    if (!envState.openclawOk) {
      progText.textContent = '进度 3/3 (安装 OpenClaw)...';
      const ok = await installOpenclawTask();
      if (!ok) throw new Error('OpenClaw 部署中断');
    }

    logOk('========== 一键部署全部成功 ==========');
    progText.textContent = '全部完成，正在初始化配置...';
    
    // 初始化集群和写入配置
    logInfo('🚀 正在自动初始化 OpenClaw（openclaw setup）...');
    const code = await runCmd('openclaw', ['setup']);
    if (code !== 0) logWarn(`⚠ openclaw setup 退出码 ${code}，继续写入默认配置...`);
    
    logInfo('📝 正在写入默认配置项...');
    const res = await api.writeDefaultConfig();
    if (res.ok) logOk(`✓ 默认配置已写入: ${res.path}`);
    else logWarn(`⚠ 配置写入失败: ${res.error}`);

  } catch (err) {
    logErr(`[部署终止] ${err.message}`);
    progText.textContent = '部署失败！';
    progText.style.color = 'var(--danger)';
  } finally {
    // 隐藏进度条容器，触发全局检测切换视图
    setTimeout(() => {
      progContainer.style.display = 'none';
      btn.disabled = false;
    }, 2000);
    await checkEnvStatus();
  }
};



// ===== 控制台快捷指令 =====
document.getElementById('btn-cmd-install-global').onclick = () => {
  logInfo('正在执行: npm install -g openclaw@latest');
  api.runInTerminal('cmd.exe', ['/c', 'npm install -g openclaw@latest --registry=https://registry.npmmirror.com']);
};

document.getElementById('btn-cmd-setup').onclick = () => {
  logInfo('正在执行: openclaw setup');
  api.runInTerminal('openclaw', ['setup']);
};

document.getElementById('btn-cmd-config').onclick = () => {
  logInfo('正在执行: openclaw config');
  api.runInTerminal('openclaw', ['config']);
};

document.getElementById('btn-cmd-restart').onclick = () => {
  logInfo('正在执行: openclaw gateway');
  api.runInTerminal('openclaw', ['gateway']);
};


// ===== 飞书集成页面 =====

// 官网直达
document.getElementById('btn-feishu-portal').onclick = () => {
  api.openExternal('https://open.feishu.cn/app');
};

// ===== 飞书集成页 前置准备 复制功能 =====

function bindCopy(btnId, textToCopy, originalText) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(textToCopy);
      btn.textContent = '✅ 已复制';
      btn.style.color = 'var(--success)';
      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.color = '';
      }, 2000);
    } catch (e) {
      logErr('复制到剪贴板失败: ' + e.message);
    }
  };
}

bindCopy('btn-copy-feishu-scopes', document.getElementById('feishu-scopes-json')?.value || '', '📋 复制配置');
bindCopy('btn-copy-feishu-event', document.getElementById('feishu-event-name')?.textContent || '', '📋 复制名称');

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
  logInfo('在新 CMD 窗口中运行: npm config set registry https://registry.npmmirror.com && openclaw plugins install @m1heng-clawd/feishu');
  api.runInTerminal('cmd.exe', ['/c', 'npm config set registry https://registry.npmmirror.com && openclaw plugins install @m1heng-clawd/feishu']);
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

// ===== 快捷指令页 =====

document.getElementById('btn-cmd-reload').onclick = () => {
  logInfo('正在执行: openclaw gateway restart');
  api.runInTerminal('openclaw', ['gateway', 'restart']);
};

document.getElementById('btn-cmd-qwen').onclick = () => {
  logInfo('正在检测并激活内置的 qwen-portal-auth 大模型通讯插件...');
  logInfo('随后将唤起千问大模型自动化配置!');
  api.runInTerminal('cmd.exe', ['/c', 'openclaw plugins enable qwen-portal-auth && openclaw models auth login --provider qwen-portal --set-default']);
};

document.getElementById('btn-cmd-uninstall').onclick = async () => {
  const confirmStr = confirm("卸载操作将移除 OpenClaw 核心程序，并永久清空 ~/.openclaw 目录下的所有配置、会话记录与工作区数据。\n\n您确定要继续吗？");
  if (!confirmStr) return;
  
  logWarn('正在执行主程序卸载操作：npm uninstall -g openclaw');
  api.runInTerminal('npm', ['uninstall', '-g', 'openclaw']);
  
  logWarn('正在清理 .openclaw 本地数据匣子...');
  const res = await api.removeOpenclawDir();
  if (res.removed) {
    logOk(`已成功删除数据目录: ${res.path}`);
  } else if (res.error) {
    logErr(`删除数据目录失败: ${res.error}`);
  } else {
    logInfo(`未找到或已清理数据目录: ${res.path}`);
  }
};

// 卸载界面程序自身
document.getElementById('btn-cmd-uninstall-app').onclick = async () => {
  const confirmStr = confirm("此操作将运行卸载程序并移除 OpenClaw Help 界面工具（不会移除系统底层的 OpenClaw 核心与运行环境）。\n\n您确定要继续吗？");
  if (!confirmStr) return;
  
  logWarn('正在尝试启动卸载程序...');
  const res = await api.uninstallApp();
  if (res && !res.ok) {
    logErr('无法启动卸载程序: ' + (res.error || '未知错误'));
    alert('卸载失败: ' + (res.error || '可能是因为这并非正式安装的版本。'));
  }
  // 若成功则不会执行到这里，因为主进程直接就退出了
};

// ===== 配置文件页 =====

const configEditor = document.getElementById('config-editor');
const btnConfigSave = document.getElementById('btn-config-save');
const configStatus = document.getElementById('config-save-status');

// 切换到配置页面时自动读取
document.getElementById('nav-config').addEventListener('click', async () => {
  configEditor.value = '加载中...';
  btnConfigSave.disabled = true;
  configStatus.textContent = '';
  document.getElementById('config-gateway-link-area').style.display = 'none';
  
  const res = await api.modelConfigRead();
  if (res.ok) {
    configEditor.value = res.content;
    logOk(`已读取配置文件: ${res.path}`);
    
    // 尝试解析并提取 Gateway Token
    try {
      const cfg = JSON.parse(res.content);
      const token = cfg?.gateway?.auth?.token;
      if (token) {
        const urlStr = `http://localhost:18789?token=${encodeURIComponent(token)}`;
        document.getElementById('config-gateway-url').textContent = urlStr;
        document.getElementById('config-gateway-url').href = urlStr;
        document.getElementById('config-gateway-link-area').style.display = 'flex';
        
        document.getElementById('btn-config-open-web').onclick = () => {
          logInfo(`🌐 浏览器打开: ${urlStr}`);
          api.openExternal(urlStr);
        };
      }
    } catch (e) {
      logWarn('解析配置 Token 失败，将隐藏链接展示。');
    }
  } else {
    configEditor.value = `读取失败: ${res.error}\n这可能是因为当前未执行过 setup，或是文件被移动。`;
    logErr(`读取配置失败: ${res.error}`);
  }
  btnConfigSave.disabled = false;
});

// 保存配置
btnConfigSave.onclick = async () => {
  const content = configEditor.value;
  btnConfigSave.disabled = true;
  btnConfigSave.textContent = '保存中...';
  configStatus.textContent = '';
  
  // 简单的 JSON 格式校验预警
  try {
    JSON.parse(content);
  } catch (e) {
    configStatus.textContent = `⚠️ 格式提示: 修改后的内容非标准 JSON (${e.message})，可能导致读取崩溃`;
    configStatus.style.color = 'var(--warning)';
    logWarn(`尝试保存的配置非标准 JSON 格式: ${e.message}`);
  }
  
  const res = await api.modelConfigWrite(content);
  btnConfigSave.disabled = false;
  btnConfigSave.textContent = '💾 保存修改';
  
  if (res.ok) {
    if (!configStatus.textContent.includes('⚠️')) {
      configStatus.textContent = `✅ 已成功保存至 ${res.path}`;
      configStatus.style.color = 'var(--success)';
    }
    logOk(`配置文件保存成功`);
  } else {
    configStatus.textContent = `❌ 保存失败: ${res.error}`;
    configStatus.style.color = 'var(--danger)';
    logErr(`保存配置失败: ${res.error}`);
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

  // 2. 获取 MAC 地址（仅用于展示和后端凭据换取）
  try {
    const mac = await api.getMac();
    state.mac = mac;
    document.getElementById('sidebar-mac').textContent = mac || '-';
  } catch (err) {
    document.getElementById('sidebar-mac').textContent = '-';
  }

  // 3. 进入主界面
  showMain();
}

init();
