const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制
  minimize: () => ipcRenderer.send('win-minimize'),
  maximize: () => ipcRenderer.send('win-maximize'),
  close:    () => ipcRenderer.send('win-close'),

  // 配置
  getConfig:  () => ipcRenderer.invoke('get-config'),
  saveConfig: (data) => ipcRenderer.invoke('save-config', data),

  // MAC 地址获取
  getMac:    () => ipcRenderer.invoke('get-mac'),

  // 环境检测
  checkEnv:   () => ipcRenderer.invoke('check-env'),
  refreshEnv: () => ipcRenderer.invoke('refresh-env'),

  // Fallback 安装（无 winget 时从镜像下载安装包，或使用本地包）
  installWinget:           (taskId) => ipcRenderer.invoke('install-winget', taskId),
  installNodeFallback:     (taskId) => ipcRenderer.invoke('install-node-fallback', taskId),
  installGitFallback:      (taskId) => ipcRenderer.invoke('install-git-fallback', taskId),
  installOpenclawFallback: (taskId) => ipcRenderer.invoke('install-openclaw-fallback', taskId),
  installVCRedistFallback: (taskId) => ipcRenderer.invoke('install-vcredist-fallback', taskId),

  // 命令执行
  runCommand: (cmd, args, taskId) => ipcRenderer.invoke('run-command', cmd, args, taskId),
  onCommandOutput: (callback) => {
    ipcRenderer.on('command-output', (_, data) => callback(data));
  },
  removeCommandOutputListener: () => {
    ipcRenderer.removeAllListeners('command-output');
  },

  // OpenClaw 配置
  openclawConfigGet: (keyPath) => ipcRenderer.invoke('openclaw-config-get', keyPath),
  openclawConfigSet: (keyPath, value) => ipcRenderer.invoke('openclaw-config-set', keyPath, value),

  // 外部链接
  openExternal: (url) => ipcRenderer.send('open-external', url),

  // 系统信息
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),

  // 在新 CMD 终端中运行（交互式命令）
  runInTerminal: (cmd, args) => ipcRenderer.invoke('run-in-terminal', cmd, args),

  // 删除扩展/缓存目录
  removeFeishuDir:   () => ipcRenderer.invoke('remove-feishu-dir'),
  removeOpenclawDir: () => ipcRenderer.invoke('remove-openclaw-dir'),

  // 模型配置
  modelConfigRead:   ()           => ipcRenderer.invoke('model-config-read'),
  modelConfigWrite:  (content)    => ipcRenderer.invoke('model-config-write', content),

  // 飞书频道配置
  feishuChannelApply: (appId, appSecret) => ipcRenderer.invoke('feishu-channel-apply', appId, appSecret),

  writeDefaultConfig: () => ipcRenderer.invoke('write-default-config'),

  // 网关后台读取 token
  gatewayReadToken: () => ipcRenderer.invoke('gateway-read-token'),

  // 卸载自身
  uninstallApp: () => ipcRenderer.invoke('uninstall-app'),
});
