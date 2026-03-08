const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制
  minimize: () => ipcRenderer.send('win-minimize'),
  maximize: () => ipcRenderer.send('win-maximize'),
  close:    () => ipcRenderer.send('win-close'),

  // 配置
  getConfig:  () => ipcRenderer.invoke('get-config'),
  saveConfig: (data) => ipcRenderer.invoke('save-config', data),

  // 授权
  getMac:    () => ipcRenderer.invoke('get-mac'),
  checkAuth: (mac) => ipcRenderer.invoke('check-auth', mac),

  // 环境检测
  checkEnv:   () => ipcRenderer.invoke('check-env'),
  refreshEnv: () => ipcRenderer.invoke('refresh-env'),

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

  // 删除飞书扩展目录
  removeFeishuDir: () => ipcRenderer.invoke('remove-feishu-dir'),

  // 模型配置
  modelConfigRead:   ()           => ipcRenderer.invoke('model-config-read'),
  modelFetchApiKey:  (mac)        => ipcRenderer.invoke('model-fetch-apikey', mac),
  modelConfigApply:  (apiKey)     => ipcRenderer.invoke('model-config-apply', apiKey),

  // 飞书频道配置
  feishuChannelApply: (appId, appSecret) => ipcRenderer.invoke('feishu-channel-apply', appId, appSecret),

  // 写入默认配置
  writeDefaultConfig: () => ipcRenderer.invoke('write-default-config'),

  // 网关后台启动 & 读取 token
  gatewayStartBg:   () => ipcRenderer.invoke('gateway-start-bg'),
  gatewayReadToken: () => ipcRenderer.invoke('gateway-read-token'),
});
