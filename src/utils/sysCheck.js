const { spawn, execSync } = require("child_process");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

// 全局维护最新 PATH（安装工具后刷新）
let currentEnvPath = process.env.PATH || "";

// ===================== 下载配置 =====================
const NODE_VERSION = "22.14.0";
const NODE_MSI_URL = `https://npmmirror.com/mirrors/node/v${NODE_VERSION}/node-v${NODE_VERSION}-x64.msi`;
const GIT_VERSION = "2.47.1.2";
const GIT_EXE_URL = `https://registry.npmmirror.com/-/binary/git-for-windows/v${GIT_VERSION}/Git-${GIT_VERSION}-64-bit.exe`;

/**
 * 从 Windows 注册表读取最新 PATH，刷新内存中的环境变量
 * 解决安装 Node.js / Git 后需要重开终端的问题
 */
async function refreshEnvPath() {
  return new Promise((resolve) => {
    try {
      const machinePath = execSync(
        `powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable('Path','Machine')"`,
        { encoding: "utf8", timeout: 5000 },
      ).trim();

      const userPath = execSync(
        `powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable('Path','User')"`,
        { encoding: "utf8", timeout: 5000 },
      ).trim();

      currentEnvPath = [machinePath, userPath].filter(Boolean).join(";");
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
    const text = buf.toString("utf8");
    // 检测是否含有 UTF-8 替换字符（乱码标志）
    if (text.includes("\uFFFD")) throw new Error("not utf8");
    return text;
  } catch {
    // 降级：尝试用 latin1 再做 Buffer 转换（简单 GBK 兼容）
    // 如需完整 GBK 支持可引入 iconv-lite
    return buf.toString("binary");
  }
}

function runCommand(cmd, args, onOutput, options = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...getEnv() };
    // 在 Windows 上通过 cmd /c "chcp 65001 > nul && <command>" 切换代码页到 UTF-8
    // 这样子进程输出的中文字符（如错误信息）就是 UTF-8 而不是 GBK，避免 Node.js 显示乱码
    const isWin = process.platform === "win32";
    let spawnCmd = cmd;
    let spawnArgs = args;
    let spawnOpts = { env, shell: true, stdin: "pipe", ...options };

    if (isWin) {
      const rawCmd = [cmd, ...args].join(" ");
      spawnCmd = "cmd";
      spawnArgs = ["/c", `chcp 65001 > nul && ${rawCmd}`];
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

    proc.stdout.on("data", (buf) => {
      const text = decodeOutput(buf);
      const lines = text.split(/\r?\n/).filter(Boolean);
      lines.forEach((line) => onOutput(line, "stdout"));
      if (autoYesPatterns.some((p) => p.test(text))) {
        try {
          proc.stdin.write("y\n");
          onOutput("[自动应答: y]", "info");
        } catch {}
      }
    });

    proc.stderr.on("data", (buf) => {
      const text = decodeOutput(buf);
      const lines = text.split(/\r?\n/).filter(Boolean);
      lines.forEach((line) => onOutput(line, "stderr"));
      if (autoYesPatterns.some((p) => p.test(text))) {
        try {
          proc.stdin.write("y\n");
          onOutput("[自动应答: y]", "info");
        } catch {}
      }
    });

    proc.on("close", (code) => {
      onOutput(`[进程退出，代码: ${code}]`, code === 0 ? "done" : "error");
      resolve(code);
    });

    proc.on("error", (err) => {
      onOutput(`启动失败: ${err.message}`, "error");
      reject(err);
    });
  });
}

/**
 * 检测 winget 是否可用
 * @returns {boolean}
 */
function checkWinget() {
  try {
    execSync("where winget", {
      encoding: "utf8",
      timeout: 5000,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 安装 winget (Windows Package Manager)
 * 下载 VCLibs + UI.Xaml + winget msixbundle，通过 Add-AppxPackage 安装
 * @param {function} onOutput - 日志回调
 * @returns {Promise<number>} 0=成功, 非0=失败
 */
async function installWinget(onOutput) {
  const tmpDir = os.tmpdir();
  const vclibsUrl = 'https://aka.ms/Microsoft.VCLibs.x64.14.00.Desktop.appx';
  const xamlNupkgUrl = 'https://globalcdn.nuget.org/packages/microsoft.ui.xaml.2.8.6.nupkg';
  const wingetUrl = 'https://github.com/microsoft/winget-cli/releases/latest/download/Microsoft.DesktopAppInstaller_8wekyb3d8bbwe.msixbundle';

  const vclibsPath = path.join(tmpDir, 'Microsoft.VCLibs.x64.14.00.Desktop.appx');
  const xamlNupkgPath = path.join(tmpDir, 'microsoft.ui.xaml.2.8.6.nupkg');
  const xamlExtractDir = path.join(tmpDir, 'microsoft.ui.xaml.2.8.6');
  const wingetPath = path.join(tmpDir, 'Microsoft.DesktopAppInstaller.msixbundle');

  try {
    // 1. 下载 VCLibs
    onOutput('📥 [1/3] 正在下载 Microsoft.VCLibs...', 'info');
    let lastPercent = -1;
    await downloadFile(vclibsUrl, vclibsPath, (percent, dlMB, totalMB) => {
      const rounded = Math.floor(percent / 10) * 10;
      if (rounded > lastPercent) { lastPercent = rounded; onOutput(`   下载进度: ${percent}%  (${dlMB}/${totalMB} MB)`, 'stdout'); }
    });
    onOutput('✓ VCLibs 下载完成', 'done');

    // 2. 下载 UI.Xaml
    onOutput('📥 [2/3] 正在下载 Microsoft.UI.Xaml...', 'info');
    lastPercent = -1;
    await downloadFile(xamlNupkgUrl, xamlNupkgPath, (percent, dlMB, totalMB) => {
      const rounded = Math.floor(percent / 10) * 10;
      if (rounded > lastPercent) { lastPercent = rounded; onOutput(`   下载进度: ${percent}%  (${dlMB}/${totalMB} MB)`, 'stdout'); }
    });
    onOutput('✓ UI.Xaml 下载完成', 'done');

    // 3. 下载 winget
    onOutput('📥 [3/3] 正在下载 winget (Microsoft.DesktopAppInstaller)...', 'info');
    onOutput('   来源: github.com/microsoft/winget-cli (可能较慢)', 'stdout');
    lastPercent = -1;
    await downloadFile(wingetUrl, wingetPath, (percent, dlMB, totalMB) => {
      const rounded = Math.floor(percent / 10) * 10;
      if (rounded > lastPercent) { lastPercent = rounded; onOutput(`   下载进度: ${percent}%  (${dlMB}/${totalMB} MB)`, 'stdout'); }
    });
    onOutput('✓ winget 下载完成', 'done');

    // 4. 解压 UI.Xaml nupkg（它实际是 zip）
    onOutput('📦 正在解压 UI.Xaml...', 'info');
    await new Promise((resolve, reject) => {
      const proc = spawn('powershell', [
        '-NoProfile', '-Command',
        `Expand-Archive -Path '${xamlNupkgPath}' -DestinationPath '${xamlExtractDir}' -Force`
      ], { env: getEnv(), stdio: 'pipe' });
      proc.stderr.on('data', (buf) => { const t = buf.toString().trim(); if (t) onOutput(`   ${t}`, 'stderr'); });
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`解压失败，代码: ${code}`)));
      proc.on('error', reject);
    });

    // 5. 依次安装
    onOutput('⚙️ 正在安装 VCLibs...', 'info');
    await runPsAppxInstall(vclibsPath, onOutput);

    const xamlAppxPath = path.join(xamlExtractDir, 'tools', 'AppX', 'x64', 'Release', 'Microsoft.UI.Xaml.2.8.appx');
    if (fs.existsSync(xamlAppxPath)) {
      onOutput('⚙️ 正在安装 UI.Xaml...', 'info');
      await runPsAppxInstall(xamlAppxPath, onOutput);
    } else {
      onOutput('⚠ 未找到 UI.Xaml appx 文件，跳过（winget 可能仍可安装）', 'stderr');
    }

    onOutput('⚙️ 正在安装 winget...', 'info');
    await runPsAppxInstall(wingetPath, onOutput);

    // 6. 刷新 PATH
    await refreshEnvPath();

    // 7. 验证安装
    const ok = checkWinget();
    if (ok) {
      onOutput('✓ winget 安装成功！', 'done');
    } else {
      onOutput('⚠ winget 已安装但未在 PATH 中检测到，可能需要重启', 'stderr');
    }

    // 清理
    setTimeout(() => {
      try { fs.unlinkSync(vclibsPath); } catch {}
      try { fs.unlinkSync(xamlNupkgPath); } catch {}
      try { fs.unlinkSync(wingetPath); } catch {}
      try { fs.rmSync(xamlExtractDir, { recursive: true, force: true }); } catch {}
    }, 3000);

    return ok ? 0 : 1;
  } catch (err) {
    onOutput(`✗ winget 安装失败: ${err.message}`, 'error');
    // 清理
    try { fs.unlinkSync(vclibsPath); } catch {}
    try { fs.unlinkSync(xamlNupkgPath); } catch {}
    try { fs.unlinkSync(wingetPath); } catch {}
    try { fs.rmSync(xamlExtractDir, { recursive: true, force: true }); } catch {}
    return 1;
  }
}

/**
 * 辅助：通过 PowerShell Add-AppxPackage 安装 appx/msixbundle
 */
function runPsAppxInstall(filePath, onOutput) {
  return new Promise((resolve, reject) => {
    const proc = spawn('powershell', [
      '-NoProfile', '-Command',
      `Add-AppxPackage -Path '${filePath}' -ErrorAction SilentlyContinue`
    ], { env: getEnv(), stdio: 'pipe' });
    proc.stdout.on('data', (buf) => {
      const t = buf.toString().trim();
      if (t) onOutput(`   ${t}`, 'stdout');
    });
    proc.stderr.on('data', (buf) => {
      const t = buf.toString().trim();
      if (t) onOutput(`   ${t}`, 'stderr');
    });
    proc.on('close', (code) => {
      // Add-AppxPackage 可能返回非零但实际已安装，所以不严格检查
      resolve(code);
    });
    proc.on('error', reject);
  });
}

/**
 * 下载文件到本地
 * @param {string} url - 下载地址
 * @param {string} destPath - 本地保存路径
 * @param {function} onProgress - 进度回调(percent, downloadedMB, totalMB)
 * @returns {Promise<string>} 下载完成后的文件路径
 */
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const doRequest = (reqUrl) => {
      const mod = reqUrl.startsWith("https") ? https : http;
      mod
        .get(reqUrl, (res) => {
          // 处理 301/302 重定向
          if (
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            return doRequest(res.headers.location);
          }
          if (res.statusCode !== 200) {
            return reject(new Error(`下载失败，HTTP ${res.statusCode}`));
          }

          const totalBytes = parseInt(res.headers["content-length"] || "0", 10);
          let downloadedBytes = 0;
          const file = fs.createWriteStream(destPath);

          res.on("data", (chunk) => {
            downloadedBytes += chunk.length;
            file.write(chunk);
            if (onProgress && totalBytes > 0) {
              const percent = Math.round((downloadedBytes / totalBytes) * 100);
              const dlMB = (downloadedBytes / 1048576).toFixed(1);
              const totalMB = (totalBytes / 1048576).toFixed(1);
              onProgress(percent, dlMB, totalMB);
            }
          });

          res.on("end", () => {
            file.end(() => resolve(destPath));
          });

          res.on("error", (err) => {
            file.close();
            try {
              fs.unlinkSync(destPath);
            } catch {}
            reject(err);
          });
        })
        .on("error", reject);
    };
    doRequest(url);
  });
}

/**
 * 模糊获取本地预置安装包的路径
 * @param {string} prefix 文件名前缀
 * @param {string} suffix 文件名后缀 (忽略大小写)
 * @returns {string|null} 存在则返回绝对路径，否则返回 null
 */
function findLocalInstaller(prefix, suffix) {
  // 打包后： resources/installers/
  // 开发时：项目根目录/installers/
  const possiblePaths = [
    path.join(process.resourcesPath || '', 'installers'),
    path.join(__dirname, '..', '..', 'installers')
  ];
  for (const dir of possiblePaths) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      const pkg = files.find(f => {
        const lowerF = f.toLowerCase();
        const lowerPrefix = prefix.toLowerCase();
        const lowerSuffix = suffix.toLowerCase();
        return lowerF.startsWith(lowerPrefix) && lowerF.endsWith(lowerSuffix);
      });
      if (pkg) {
        return path.join(dir, pkg);
      }
    }
  }
  return null;
}

/**
 * Fallback 安装 Node.js：优先检查本地内置包，否则从镜像下载 MSI 并静默安装
 * @param {function} onOutput - 日志回调
 * @returns {Promise<number>} 0=成功, 非0=失败
 */
async function installNodeFallback(onOutput) {
  const finalFilename = `node-v${NODE_VERSION}-x64.msi`;
  let msiPath = findLocalInstaller('node-v', '.msi');
  let isFromNetwork = false;

  if (msiPath) {
    onOutput(`📥 发现内置的 Node.js 安装包: ${msiPath}`, "info");
  } else {
    isFromNetwork = true;
    msiPath = path.join(os.tmpdir(), finalFilename);
    try {
      onOutput(
        `📥 未检测到内置安装包，正在从镜像下载 Node.js v${NODE_VERSION} MSI...`,
        "info",
      );
    onOutput(`   地址: ${NODE_MSI_URL}`, "stdout");

    let lastPercent = -1;
    await downloadFile(NODE_MSI_URL, msiPath, (percent, dlMB, totalMB) => {
      // 每 10% 输出一次进度
      const rounded = Math.floor(percent / 10) * 10;
      if (rounded > lastPercent) {
        lastPercent = rounded;
        onOutput(`   下载进度: ${percent}%  (${dlMB}/${totalMB} MB)`, "stdout");
      }
    });
    onOutput("✓ 下载完成，正在静默安装...", "info");
  } catch (err) {
    onOutput(`✗ 下载 Node.js 失败: ${err.message}`, "error");
    if (isFromNetwork) {
      try { fs.unlinkSync(msiPath); } catch {}
    }
    return 1;
  }
  }

  // 使用 msiexec 静默安装（需要管理员权限，通过 VBS 提权）
  const installCmd = `msiexec /i "${msiPath}" /qn /norestart`;
  onOutput(`   执行: ${installCmd}`, "stdout");

  const code = await new Promise((resolve, reject) => {
    // 同样因为提权不能拿到跨进程的精确 ExitCode，所以只进行执行流阻塞，并抹除异常报错的管道
    const psCmd = `Start-Process -FilePath 'msiexec' -ArgumentList '/i', '"${msiPath}"', '/qn', '/norestart' -Verb RunAs -Wait`;
    const proc = spawn("powershell", ["-NoProfile", "-Command", psCmd], {
      env: getEnv(),
      stdio: "pipe",
    });

    proc.stdout.on("data", (buf) => {
      const text = buf.toString().trim();
      if (text) onOutput(`   ${text}`, "stdout");
    });
    proc.stderr.on("data", (buf) => {
      const text = buf.toString().trim();
      if (text) onOutput(`   ${text}`, "stderr");
    });
    proc.on("close", (exitCode) => {
      resolve(exitCode);
    });
    proc.on("error", reject);
  });

  // 清理安装包（仅限下载的临时文件）
  if (isFromNetwork) {
    setTimeout(() => { try { fs.unlinkSync(msiPath); } catch {} }, 3000);
  }

  if (code === 0) {
    onOutput("✓ Node.js 安装完成！", "done");
  } else {
    onOutput(`✗ 安装退出码: ${code}`, "error");
  }
  return code;
}

/**
 * Fallback 安装 Git：优先检查本地内置包，否则从镜像下载 exe 并静默安装
 * @param {function} onOutput - 日志回调
 * @returns {Promise<number>} 0=成功, 非0=失败
 */
async function installGitFallback(onOutput) {
  const finalFilename = `Git-${GIT_VERSION}-64-bit.exe`;
  let exePath = findLocalInstaller('Git-', '.exe');
  let isFromNetwork = false;

  if (exePath) {
    onOutput(`📥 发现内置的 Git 安装包: ${exePath}`, "info");
  } else {
    isFromNetwork = true;
    exePath = path.join(os.tmpdir(), finalFilename);
    try {
      onOutput(`📥 未检测到内置安装包，正在从镜像下载 Git v${GIT_VERSION} 安装包...`, "info");
    onOutput(`   地址: ${GIT_EXE_URL}`, "stdout");

    let lastPercent = -1;
    await downloadFile(GIT_EXE_URL, exePath, (percent, dlMB, totalMB) => {
      const rounded = Math.floor(percent / 10) * 10;
      if (rounded > lastPercent) {
        lastPercent = rounded;
        onOutput(`   下载进度: ${percent}%  (${dlMB}/${totalMB} MB)`, "stdout");
      }
    });
    onOutput("✓ 下载完成，正在静默安装...", "info");
  } catch (err) {
    onOutput(`✗ 下载 Git 失败: ${err.message}`, "error");
    if (isFromNetwork) {
      try { fs.unlinkSync(exePath); } catch {}
    }
    return 1;
  }
  }

  // Git 的 Inno Setup 安装器用 /VERYSILENT /NORESTART 参数
  const installArgs =
    "/VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS";
  onOutput(`   执行: "${exePath}" ${installArgs}`, "stdout");

  const code = await new Promise((resolve, reject) => {
    // 改用抛弃管道的稳健写法：Start-Process 提权自带阻塞但跨进程不一定能拿回返回值，
    // 为了稳定，我们只等待进程执行完毕，并在捕获不到数字退出码时默认为 0（因为向导有自己的全局文件校验会兜底）
    const psCmd = `Start-Process -FilePath '"${exePath}"' -ArgumentList '${installArgs}' -Verb RunAs -Wait`;
    const proc = spawn("powershell", ["-NoProfile", "-Command", psCmd], {
      env: getEnv(),
      stdio: "pipe",
    });

    proc.stdout.on("data", (buf) => {
      const text = buf.toString().trim();
      if (text) onOutput(`   ${text}`, "stdout");
    });
    proc.stderr.on("data", (buf) => {
      const text = buf.toString().trim();
      if (text) onOutput(`   ${text}`, "stderr");
    });
    proc.on("close", (exitCode) => {
      // 只要提权的 PowerShell 本身未崩溃，我们就视作成功（因为静默安装器内部的报错无法跨越 Elevation 层返回给普通的 PS 进程）
      resolve(exitCode);
    });
    proc.on("error", reject);
  });

  // 清理安装包（仅限下载的临时文件）
  if (isFromNetwork) {
    setTimeout(() => { try { fs.unlinkSync(exePath); } catch {} }, 3000);
  }

  if (code === 0) {
    onOutput("✓ Git 安装完成！", "done");
  } else {
    onOutput(`✗ 安装退出码: ${code}`, "error");
  }
  return code;
}

/**
 * 检测 Node.js 版本
 * @returns {Promise<string|null>} 版本字符串或 null
 */
async function checkNode() {
  try {
    const ver = execSync("node -v", {
      encoding: "utf8",
      env: getEnv(),
      timeout: 5000,
    }).trim();
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
    const ver = execSync("git --version", {
      encoding: "utf8",
      env: getEnv(),
      timeout: 5000,
    }).trim();
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
    const ver = execSync("openclaw --version", {
      encoding: "utf8",
      env: getEnv(),
      timeout: 5000,
    }).trim();
    return ver;
  } catch {
    return null;
  }
}

/**
 * Fallback 安装 OpenClaw：优先检查本地内置 tarball 包，否则使用 npm 挂载 registry 安装最新版
 * @param {function} onOutput - 日志回调
 * @returns {Promise<number>} 0=成功, 非0=失败
 */
async function installOpenclawFallback(onOutput) {
  // 查找 built-in installer 目录里是否有 openclaw-*.tgz
  const installDir1 = path.join(process.resourcesPath || '', 'installers');
  const installDir2 = path.join(__dirname, '..', '..', 'installers');
  
  let tgzPath = null;
  for (const dir of [installDir1, installDir2]) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      const pkg = files.find(f => f.startsWith('openclaw-') && f.endsWith('.tgz'));
      if (pkg) {
        tgzPath = path.join(dir, pkg);
        break;
      }
    }
  }

  let cmd, args;
  if (tgzPath) {
    onOutput(`📥 发现内置的 OpenClaw 安装包: ${tgzPath}`, 'info');
    onOutput('   🧹 正在卸载可能存在的旧版 OpenClaw...', 'info');
    // 先尝试移除旧版本，不关心成功与否
    await new Promise((resolve) => {
      const proc = spawn('cmd.exe', ['/c', 'npm uninstall -g openclaw'], { env: getEnv() });
      proc.on('close', () => resolve());
    });

    cmd = 'npm';
    args = ['install', '-g', tgzPath, '--loglevel=info', '--registry=https://registry.npmmirror.com'];
    onOutput(`   执行: npm install -g "${tgzPath}" --loglevel=info --registry=...`, 'stdout');
  } else {
    onOutput('📥 未检测到内置安装包，正在从 npm 官方仓库下载...', 'info');
    cmd = 'npm';
    args = ['install', '-g', 'openclaw@latest', '--loglevel=info', '--registry=https://registry.npmmirror.com'];
    onOutput('   执行: npm install -g openclaw@latest --loglevel=info --registry=...', 'stdout');
  }

  const code = await new Promise((resolve, reject) => {
    let executable = 'npm';
    if (process.platform === 'win32') {
      executable = 'npm.cmd';
    }

    const proc = spawn(executable, args, { env: getEnv(), stdio: 'pipe' });

    proc.stdout.on('data', buf => {
      const text = buf.toString().trim();
      if (text) onOutput(`   ${text}`, 'stdout');
    });
    proc.stderr.on('data', buf => {
      const text = buf.toString().trim();
      if (text) onOutput(`   ${text}`, 'stderr');
    });
    proc.on('close', code => resolve(code));
    proc.on('error', reject);
  });

  if (code === 0) {
    onOutput('✓ OpenClaw 安装完成！', 'done');
  } else {
    onOutput(`✗ 安装退出码: ${code}`, 'error');
  }
  return code;
}

/**
 * Fallback 安装 VC Redist 2015-2022 (解决 node-llama-cpp 无环境崩溃问题)
 * @param {function} onOutput - 日志回调
 * @returns {Promise<number>} 0=成功, 非0=失败, 2=已安装并跳过
 */
async function installVCRedistFallback(onOutput) {
  // 1. 检查注册表看是否已安装过 VC Redist 2015-2022 x64
  onOutput(`🔍 正在检查系统是否已安装 VC 运行库...`, "info");
  const isInstalled = await new Promise((resolve) => {
    // 检查注册表的卸载列表里是否存在
    // 微软的 Guid 可能改变，保险起见用通配符匹配 DisplayName
    const psCmd = `Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* | Where-Object {$_.DisplayName -match "Microsoft Visual C\\+\\+ 2015-2022 Redistributable \\(x64\\)"} | Select-Object -ExpandProperty DisplayVersion`;
    const proc = spawn("powershell", ["-NoProfile", "-Command", psCmd], { env: getEnv() });
    let output = '';
    proc.stdout.on("data", (b) => { output += b.toString(); });
    proc.on("close", (code) => {
      resolve(output.trim().length > 0 && code === 0);
    });
  });

  if (isInstalled) {
    onOutput(`✓ 检测到已安装 VC++ 2015-2022 Redistributable (x64)，无需重复安装！`, "done");
    return 2; // 用 2 表示跳过
  }

  const finalFilename = `vc_redist.x64.exe`;
  let exePath = findLocalInstaller('', finalFilename);
  let isFromNetwork = false;

  if (exePath) {
    onOutput(`📥 发现内置的 VC 运行库包: ${exePath}`, "info");
  } else {
    isFromNetwork = true;
    exePath = path.join(os.tmpdir(), finalFilename);
    const VC_URL = 'https://aka.ms/vs/17/release/vc_redist.x64.exe';
    try {
      onOutput(`📥 未检测到内置安装包，正在下载 微软 C++ 运行库...`, "info");
      onOutput(`   地址: ${VC_URL}`, "stdout");

      let lastPercent = -1;
      await downloadFile(VC_URL, exePath, (percent, dlMB, totalMB) => {
        const rounded = Math.floor(percent / 10) * 10;
        if (rounded > lastPercent) {
          lastPercent = rounded;
          onOutput(`   下载进度: ${percent}%  (${dlMB}/${totalMB} MB)`, "stdout");
        }
      });
      onOutput("✓ 下载完成，正在静默安装...", "info");
    } catch (err) {
      onOutput(`✗ 下载 运行库 失败: ${err.message}`, "error");
      if (isFromNetwork) {
        try { fs.unlinkSync(exePath); } catch {}
      }
      return 1;
    }
  }

  // VC Redist 静默安装参数，不重启，带进度但无 UI 交互
  const installArgs = "/install /quiet /norestart";
  onOutput(`   执行: "${exePath}" ${installArgs}`, "stdout");

  const code = await new Promise((resolve, reject) => {
    const psCmd = `Start-Process -FilePath '"${exePath}"' -ArgumentList '${installArgs}' -Verb RunAs -Wait`;
    const proc = spawn("powershell", ["-NoProfile", "-Command", psCmd], {
      env: getEnv(),
      stdio: "pipe",
    });

    proc.stdout.on("data", (buf) => {
      const text = buf.toString().trim();
      if (text) onOutput(`   ${text}`, "stdout");
    });
    proc.stderr.on("data", (buf) => {
      const text = buf.toString().trim();
      if (text) onOutput(`   ${text}`, "stderr");
    });
    proc.on("close", (exitCode) => {
      // 3010 也是成功的状态码（需要重启）
      resolve(exitCode === 3010 ? 0 : exitCode);
    });
    proc.on("error", reject);
  });

  // 清理临时文件
  if (isFromNetwork) {
    setTimeout(() => { try { fs.unlinkSync(exePath); } catch {} }, 3000);
  }

  if (code === 0) {
    onOutput("✓ 运行库 安装完成！", "done");
  } else {
    onOutput(`✗ 安装退出码: ${code}`, "error");
  }
  return code;
}

module.exports = {
  refreshEnvPath,
  getEnv,
  runCommand,
  checkNode,
  checkGit,
  checkOpenclaw,
  checkWinget,
  installWinget,
  downloadFile,
  installNodeFallback,
  installGitFallback,
  installOpenclawFallback,
  installVCRedistFallback,
};
