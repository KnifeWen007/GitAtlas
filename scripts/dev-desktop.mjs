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

/**
 * 单实例：开发模式跑着的时候再开一个，会出现两个服务抢同一个数据库，
 * 重启时还可能撞上 "database is locked"，所以第二个直接拒绝，并说清楚怎么处理。
 */
const pidFile = path.join(root, 'data', 'dev-desktop.pid');
const force = process.argv.includes('--force');

function readPreviousPid() {
  try {
    const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    if (!Number.isFinite(pid) || pid <= 1) return null;
    process.kill(pid, 0); // 只探测，不发送信号
    return pid;
  } catch {
    return null;
  }
}

const previousPid = readPreviousPid();
if (previousPid !== null) {
  if (!force) {
    console.log(`已经有一个开发实例在跑（PID ${previousPid}）。`);
    console.log('先关掉那个窗口，或者用 npm run dev -- --force 强制结束它再启动。');
    process.exit(1);
  }
  console.log(`按 --force 结束上一次的开发实例（PID ${previousPid}）`);
  // 连带子进程一起收掉：只杀父进程会留下孤儿服务继续占着端口和数据库
  spawn('taskkill', ['/PID', String(previousPid), '/T', '/F'], { stdio: 'ignore', shell: false });
  await new Promise((resolve) => setTimeout(resolve, 1200));
}
fs.mkdirSync(path.dirname(pidFile), { recursive: true });
fs.writeFileSync(pidFile, String(process.pid));

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
  fs.rmSync(pidFile, { force: true });
  console.log('找不到空闲端口（4400-4499 / 5400-5499），先清理一下再试。');
  process.exit(1);
}
const VITE_URL = `http://127.0.0.1:${VITE_PORT}`;
const API_URL = `http://127.0.0.1:${SERVER_PORT}`;

const children = [];
let shuttingDown = false;
/** 服务端文件监听与重启计时器，退出时要一起收掉 */
let watchers = [];
let restartTimer = null;

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
  if (restartTimer) clearTimeout(restartTimer);
  for (const watcher of watchers) {
    try {
      watcher.close();
    } catch {
      // 已经关掉了
    }
  }
  watchers = [];
  try {
    if (fs.readFileSync(pidFile, 'utf8').trim() === String(process.pid)) fs.rmSync(pidFile, { force: true });
  } catch {
    // 文件已经没了就不用管
  }
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

/** 端口空出来没有：重启服务前先确认上一个进程真的放手了 */
async function waitPortFree(port, timeoutMs = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const free = await new Promise((resolve) => {
      const probe = net.createServer();
      probe.once('error', () => resolve(false));
      probe.once('listening', () => probe.close(() => resolve(true)));
      probe.listen(port, '127.0.0.1');
    });
    if (free) return true;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return false;
}

/** 连同子进程一起结束（Windows 上 child.kill 只杀一层） */
function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // 已经退了
    }
  }
}

// 桌面版的数据目录；开发时沿用，省得每次都重新添加仓库
const desktopDb = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'GitAtlas', 'data', 'atlas.db')
  : '';
const fallbackDb = path.join(root, 'data', 'atlas.db');
const dbPath = desktopDb && fs.existsSync(desktopDb) ? desktopDb : fallbackDb;
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

/**
 * 自己管服务端进程，不用 `node --watch`。
 *
 * --watch 在 Windows 上是"先起新进程，再让旧的自己走"，而旧进程的 SIGTERM 处理
 * 会被 keep-alive 连接卡住，于是端口一直被占：每隔一次保存就报 EADDRINUSE 或者
 * "database is locked"，进程还会一个个堆起来。自己管就能先确认端口空出来再起新的。
 */
let serverChild = null;
let restartingServer = false;

function startServer() {
  // 这里的 node 可能是"Electron 伪装成 Node"的壳（有些宿主终端会这样接管 node）。
  // 直接拿 process.execPath 去跑会打开一个空窗口然后立刻退出，所以那种情况下
  // 走 PATH 上的 node，和用户平时敲命令完全一致。
  const shellNode = Boolean(process.versions.electron);
  const child = spawn(shellNode ? 'node' : process.execPath, ['packages/server/src/main.ts'], {
    cwd: root,
    stdio: 'inherit',
    shell: shellNode,
    env: {
      ...process.env,
      PORT: String(SERVER_PORT),
      ATLAS_DB: dbPath,
      LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
    },
  });
  serverChild = child;
  children.push({ label: 'server', child });
  child.on('exit', (code) => {
    if (shuttingDown || restartingServer || serverChild !== child) return;
    console.log(`\n[server] 退出了（code ${code}），正在关闭其余进程`);
    shutdown(code ?? 0);
  });
  return child;
}

async function stopServer() {
  const child = serverChild;
  if (!child || child.exitCode !== null) return true;
  restartingServer = true;
  const exited = new Promise((resolve) => child.once('exit', () => resolve(true)));
  killTree(child.pid);
  const stopped = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve(false), 3000))]);
  serverChild = null;
  restartingServer = false;
  return stopped;
}

function scheduleServerRestart(reason) {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(async () => {
    // 上一次重启还没收尾，等它一会儿再来，免得两个进程叠在一起抢端口
    if (restartingServer) {
      scheduleServerRestart(reason);
      return;
    }
    try {
      console.log(`\n接口源码变了（${reason}），重启服务…`);
      const stopped = await stopServer();
      if (!stopped) console.log(`上一个服务进程 3 秒内没退出，可能有残留`);
      if (!(await waitPortFree(SERVER_PORT))) {
        console.log(`端口 ${SERVER_PORT} 一直没放开，重启可能失败`);
      }
      startServer();
    } catch (error) {
      console.log(`重启服务失败：${error?.message ?? error}`);
    }
  }, 250);
}

function watchServerSources() {
  for (const dir of ['packages/server/src', 'packages/core/src']) {
    const absolute = path.join(root, dir);
    try {
      watchers.push(
        fs.watch(absolute, { recursive: true }, (_event, file) => {
          if (!file) return;
          const name = String(file);
          // 编辑器和我们的写入工具都会产生临时文件，这些不该触发重启
          if (/(^|[\\/])\./.test(name)) return;
          if (/\.(tmp|tmpdir|swp|swx|bak|db|db-wal|db-shm)$/i.test(name)) return;
          if (name.endsWith('~')) return;
          scheduleServerRestart(name);
        }),
      );
    } catch (error) {
      console.log(`监听 ${dir} 失败：${error?.message ?? error}`);
    }
  }
}

console.log('GitAtlas 开发模式');
console.log(`  接口  ${API_URL}`);
console.log(`  界面  ${VITE_URL}`);
console.log(`  数据  ${dbPath}`);

startServer();
watchServerSources();

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
