#!/usr/bin/env node
/**
 * 桌面端开发模式：改一行代码就能看到效果，不用打包。
 *
 * 跑三样东西：
 *   1. 服务端（node --watch，改 .ts 自动重启）
 *   2. Vite（5317，改前端热更新）
 *   3. Electron 窗口，直接加载 Vite 地址
 *
 * 数据用的是桌面版同一个库，所以仓库列表、回滚点都还在，不用重新添加。
 * 退出：关掉窗口，或在终端按 Ctrl+C。
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(import.meta.dirname, '..');

// 这个变量一旦继承下来，Electron 会把自己当普通 Node 跑并立刻退出
delete process.env.ELECTRON_RUN_AS_NODE;

/** 找一个空闲端口：4317 这类默认端口经常被别的开发服务占着 */
async function findFreePort(start, end) {
  for (let port = start; port <= end; port += 1) {
    const free = await new Promise((resolve) => {
      const tester = net.createServer();
      tester.once('error', () => resolve(false));
      tester.once('listening', () => tester.close(() => resolve(true)));
      tester.listen(port, '127.0.0.1');
    });
    if (free) return port;
  }
  return null;
}

const SERVER_PORT = await findFreePort(4400, 4499);
const VITE_PORT = await findFreePort(5400, 5499);
if (SERVER_PORT === null || VITE_PORT === null) {
  console.log('找不到空闲端口（4400-4499 / 5400-5499），先清理一下再试。');
  process.exit(1);
}
const VITE_URL = `http://127.0.0.1:${VITE_PORT}`;
const API_URL = `http://127.0.0.1:${SERVER_PORT}`;

const children = [];
let shuttingDown = false;

function run(label, command, args, extraEnv = {}, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? root,
    // Windows 上 pnpm 是 .cmd，必须走 shell；electron.exe 则直接启动更可靠
    shell: options.shell ?? true,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
  children.push({ label, child });
  child.on('exit', (code) => {
    if (shuttingDown) return;
    console.log(`\n[${label}] 已退出（code ${code}），正在关闭其余进程`);
    shutdown(code ?? 0);
  });
  return child;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) {
    if (child.exitCode !== null || child.killed) continue;
    child.kill();
  }
  setTimeout(() => process.exit(code), 800);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

/** 等某个地址能响应；开发工具起来有先后，不能盲等固定秒数 */
async function waitFor(url, label, timeoutMs = 40_000) {
  const started = Date.now();
  process.stdout.write(`等待${label} `);
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok || response.status < 500) {
        process.stdout.write(' 就绪\n');
        return true;
      }
    } catch {
      // 还没起好，继续等
    }
    process.stdout.write('.');
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  process.stdout.write('\n');
  return false;
}

// 桌面版的数据目录；开发时沿用，省得每次都重新添加仓库
const desktopDb = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'GitAtlas', 'data', 'atlas.db')
  : '';
const fallbackDb = path.join(root, 'data', 'atlas.db');
const dbPath = desktopDb && fs.existsSync(desktopDb) ? desktopDb : fallbackDb;
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

console.log('GitAtlas 开发模式');
console.log(`  接口  ${API_URL}`);
console.log(`  界面  ${VITE_URL}`);
console.log(`  数据  ${dbPath}`);

run('server', 'node', ['--watch', 'packages/server/src/main.ts'], {
  PORT: String(SERVER_PORT),
  ATLAS_DB: dbPath,
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
});

// Vite 直接用它自己的可执行文件，不经过 pnpm：
// 用 npm 或者直接 node scripts/dev-desktop.mjs 也能跑起来
const viteBin = path.join(
  root,
  'apps',
  'web',
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vite.cmd' : 'vite',
);
if (!fs.existsSync(viteBin)) {
  console.log(`没找到 Vite：${viteBin}\n先跑一次依赖安装（pnpm install 或 npm install）。`);
  process.exit(1);
}

run(
  'vite',
  viteBin,
  [],
  {
    ATLAS_API_PORT: String(SERVER_PORT),
    ATLAS_WEB_PORT: String(VITE_PORT),
  },
  { cwd: path.join(root, 'apps', 'web') },
);

if (!(await waitFor(`${API_URL}/api/health`, '接口服务'))) {
  console.log('接口没起来，先看看上面的报错。');
  shutdown(1);
} else if (!(await waitFor(VITE_URL, 'Vite'))) {
  console.log('Vite 没起来，先看看上面的报错。');
  shutdown(1);
} else {
  // 直接起 electron.exe：经 pnpm/npm 转发时环境变量会被再带回去，
  // 一旦 ELECTRON_RUN_AS_NODE 漏进来，Electron 会当普通 Node 跑并立刻退出。
  const electronExe = path.join(
    root,
    'apps',
    'desktop',
    'node_modules',
    'electron',
    'dist',
    process.platform === 'win32' ? 'electron.exe' : 'electron',
  );
  if (!fs.existsSync(electronExe)) {
    console.log(`没找到 Electron：${electronExe}\n先跑一次 pnpm install。`);
    shutdown(1);
  } else {
    run(
      'electron',
      electronExe,
      ['.'],
      {
        ATLAS_DEV_URL: VITE_URL,
        ATLAS_DEV_SKIP_BACKEND: '1',
      },
      { cwd: path.join(root, 'apps', 'desktop'), shell: false },
    );

    console.log('\n窗口起来后：改前端保存即热更新，改服务端会自动重启，都不用打包。');
  }
}
