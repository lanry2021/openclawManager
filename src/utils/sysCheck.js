const { spawn, execSync } = require('child_process');

// 全局维护最新 PATH（安装工具后刷新）
let currentEnvPath = process.env.PATH || '';

/**
 * 从 Windows 注册表读取最新 PATH，刷新内存中的环境变量
 * 解决安装 Node.js / Git 后需要重开终端的问题
 */
async function refreshEnvPath() {
  return new Promise((resolve) => {
    try {
      const machinePath = execSync(
        `powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable('Path','Machine')"`,
        { encoding: 'utf8', timeout: 5000 }
      ).trim();

      const userPath = execSync(
        `powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable('Path','User')"`,
        { encoding: 'utf8', timeout: 5000 }
      ).trim();

      currentEnvPath = [machinePath, userPath].filter(Boolean).join(';');
      process.env.PATH = currentEnvPath;
      resolve(currentEnvPath);
    } catch (e) {
      resolve(currentEnvPath); // 失败则保留旧值
    }
  });
}

/**
 * 获取当前最新环境（用于 spawn）
 */
function getEnv() {
  return { ...process.env, PATH: currentEnvPath };
}

/**
 * 执行命令，实时推送输出到回调
 * @param {string} cmd
 * @param {string[]} args
 * @param {function} onOutput - 回调(line, type) type='stdout'|'stderr'|'done'|'error'
 * @param {object} options - spawn 选项
 * @returns {Promise<number>} exit code
 */
function decodeOutput(buf) {
  // Windows 系统中文 CMD 输出是 GBK/CP936，Node 默认 UTF-8 会乱码
  // 用多字节检测：若 Buffer 不能被 UTF-8 合法解码则按 GBK 解
  try {
    const text = buf.toString('utf8');
    // 检测是否含有 UTF-8 替换字符（乱码标志）
    if (text.includes('\uFFFD')) throw new Error('not utf8');
    return text;
  } catch {
    // 降级：尝试用 latin1 再做 Buffer 转换（简单 GBK 兼容）
    // 如需完整 GBK 支持可引入 iconv-lite
    return buf.toString('binary');
  }
}

function runCommand(cmd, args, onOutput, options = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...getEnv() };
    // 在 Windows 上通过 cmd /c "chcp 65001 > nul && <command>" 切换代码页到 UTF-8
    // 这样子进程输出的中文字符（如错误信息）就是 UTF-8 而不是 GBK，避免 Node.js 显示乱码
    const isWin = process.platform === 'win32';
    let spawnCmd = cmd;
    let spawnArgs = args;
    let spawnOpts = { env, shell: true, stdin: 'pipe', ...options };

    if (isWin) {
      const rawCmd = [cmd, ...args].join(' ');
      spawnCmd = 'cmd';
      spawnArgs = ['/c', `chcp 65001 > nul && ${rawCmd}`];
    }

    const proc = spawn(spawnCmd, spawnArgs, spawnOpts);

    // 自动应答 winget / npm 的交互式 Y/N 提示
    const autoYesPatterns = [
      /\[Y\].*\[N\]/i,
      /\(y\/n\)/i,
      /Do you want to/i,
      /是否同意/,
      /proceed\?/i,
    ];

    proc.stdout.on('data', (buf) => {
      const text = decodeOutput(buf);
      const lines = text.split(/\r?\n/).filter(Boolean);
      lines.forEach(line => onOutput(line, 'stdout'));
      if (autoYesPatterns.some(p => p.test(text))) {
        try { proc.stdin.write('y\n'); onOutput('[自动应答: y]', 'info'); } catch {}
      }
    });

    proc.stderr.on('data', (buf) => {
      const text = decodeOutput(buf);
      const lines = text.split(/\r?\n/).filter(Boolean);
      lines.forEach(line => onOutput(line, 'stderr'));
      if (autoYesPatterns.some(p => p.test(text))) {
        try { proc.stdin.write('y\n'); onOutput('[自动应答: y]', 'info'); } catch {}
      }
    });

    proc.on('close', (code) => {
      onOutput(`[进程退出，代码: ${code}]`, code === 0 ? 'done' : 'error');
      resolve(code);
    });

    proc.on('error', (err) => {
      onOutput(`启动失败: ${err.message}`, 'error');
      reject(err);
    });
  });
}

/**
 * 检测 Node.js 版本
 * @returns {Promise<string|null>} 版本字符串或 null
 */
async function checkNode() {
  try {
    const ver = execSync('node -v', { encoding: 'utf8', env: getEnv(), timeout: 5000 }).trim();
    return ver;
  } catch {
    return null;
  }
}

/**
 * 检测 Git 是否安装
 * @returns {Promise<string|null>} 版本字符串或 null
 */
async function checkGit() {
  try {
    const ver = execSync('git --version', { encoding: 'utf8', env: getEnv(), timeout: 5000 }).trim();
    return ver;
  } catch {
    return null;
  }
}

/**
 * 检测 openclaw 是否安装
 * @returns {Promise<string|null>}
 */
async function checkOpenclaw() {
  try {
    const ver = execSync('openclaw --version', { encoding: 'utf8', env: getEnv(), timeout: 5000 }).trim();
    return ver;
  } catch {
    return null;
  }
}

module.exports = {
  refreshEnvPath,
  getEnv,
  runCommand,
  checkNode,
  checkGit,
  checkOpenclaw,
};
