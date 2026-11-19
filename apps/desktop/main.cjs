'use strict';

/**
 * GitAtlas 桌面端主进程。
 *
 * 结构（参考 DSH Desktop 这类 Electron 应用的通行做法）：
 *   主进程 ── 启动内嵌 HTTP 服务（随机端口，只绑 127.0.0.1）
 *          └─ BrowserWindow 直接加载该服务的地址
 *
 * 这样做的好处：桌面端与 Web 端共用同一份前端与同一套 API，
 * 同源免 CORS、免配置 API 地址，也不需要 preload 暴露任何数据接口。
 */

const { app, BrowserWindow, shell, dialog, Menu, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

// 数据目录名用产品名，别让它在 %APPDATA% 下显示成 "@gitatlas/desktop"
app.setName('GitAtlas');

/** electron-builder 便携版会注入此变量：数据目录跟着 exe 走 */
const portableDir = process.env.PORTABLE_EXECUTABLE_DIR || '';
/** 开发态可指定 Vite 地址，直接用上 HMR */
const devUrl = process.env.ATLAS_DEV_URL || '';

let mainWindow = null;
let backend = null;

/** 启动日志：GUI 程序崩溃时控制台什么也看不到，只能落盘 */
function logFile() {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'startup.log');
  } catch {
    return null;
  }
}

function log(message) {
  const file = logFile();
  if (!file) return;
  try {
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    /* 日志失败不能影响启动 */
  }
}

process.on('uncaughtException', (error) => {
  log(`uncaughtException: ${error && error.stack ? error.stack : error}`);
  try {
    dialog.showErrorBox('GitAtlas 异常', String(error && error.message ? error.message : error));
  } catch {
    /* ignore */
  }
});

process.on('unhandledRejection', (reason) => {
  log(`unhandledRejection: ${reason && reason.stack ? reason.stack : reason}`);
});

if (!app.requestSingleInstanceLock()) {
  log('已有实例在运行，退出本次启动');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

function resolveDataDir() {
  return portableDir ? path.join(portableDir, 'data') : path.join(app.getPath('userData'), 'data');
}

async function startBackend() {
  const dir = resolveDataDir();
  fs.mkdirSync(dir, { recursive: true });

  const bundled = path.join(__dirname, 'build', 'server.cjs');
  let startServer;

  if (fs.existsSync(bundled)) {
    log(`加载内置服务 ${bundled}`);
    ({ startServer } = require(bundled));
  } else {
    // 开发态：Electron 44 内置 Node 24，可直接加载 TypeScript 源码（原生类型擦除）
    const entry = path.join(__dirname, '..', '..', 'packages', 'server', 'src', 'app.ts');
    log(`加载开发态服务 ${entry}`);
    ({ startServer } = await import(pathToFileURL(entry).href));
  }

  if (typeof startServer !== 'function') {
    throw new Error('内置服务没有导出 startServer');
  }

  const staticDir = path.join(__dirname, 'build', 'web');
  const hasStatic = fs.existsSync(path.join(staticDir, 'index.html'));
  log(`静态资源目录：${staticDir}（存在：${hasStatic}）`);

  backend = await startServer({
    dbPath: path.join(dir, 'atlas.db'),
    port: 0,
    host: '127.0.0.1',
    ...(hasStatic ? { staticDir } : {}),
    logLevel: 'warn',
  });

  log(`服务已启动：${backend.url}（数据目录 ${dir}）`);
  return backend;
}

async function createWindow() {
  const handle = await startBackend();
  const target = devUrl || handle.url;

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1040,
    minHeight: 660,
    backgroundColor: '#080b12',
    title: 'GitAtlas',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 目标地址可能是随机端口，必须用 https?:// 判定，不能只认固定域名
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^http:\/\/127\.0\.0\.1:/.test(url)) return { action: 'allow' };
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (/^http:\/\/127\.0\.0\.1:/.test(url)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });

  await mainWindow.loadURL(target);
  log(`窗口已加载：${target}`);

  if (process.env.ATLAS_OPEN_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

/* 系统目录选择器：桌面端"零命令行"的支点 */
ipcMain.handle('gitatlas:pick-directory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择 Git 仓库目录',
    buttonLabel: '加入 GitAtlas',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  log(`用户选择目录：${result.filePaths[0]}`);
  return result.filePaths[0];
});

app.whenReady().then(async () => {
  log('app ready');
  try {
    await createWindow();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`启动失败：${message}`);
    dialog.showErrorBox('GitAtlas 启动失败', `${message}\n\n数据目录：${resolveDataDir()}`);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  // 关掉内嵌服务，释放端口与 SQLite 文件句柄
  if (backend && typeof backend.close === 'function') {
    void backend.close().catch(() => {});
    backend = null;
  }
});
