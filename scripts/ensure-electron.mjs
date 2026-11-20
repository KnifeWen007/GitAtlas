#!/usr/bin/env node
/**
 * 补齐 Electron 运行时（apps/desktop/node_modules/electron/dist）。
 *
 * electron 44 起，安装时不再自动下载二进制：package.json 里没有 postinstall，
 * 只留了一个 `install-electron` 可执行文件。于是新克隆的仓库、CI runner 上
 * 只跑 pnpm install 的话，dist/ 是空的：
 *   - 打包会报 "The specified electronDist does not exist"
 *   - 开发模式则直接找不到 electron.exe
 *
 * 用法：
 *   node scripts/ensure-electron.mjs         缺了才下载
 *   node scripts/ensure-electron.mjs --force 强制重装
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const ROOT = path.resolve(import.meta.dirname, '..');
const DESKTOP = path.join(ROOT, 'apps', 'desktop');

/** electron 包目录；走 apps/desktop 的依赖解析，pnpm 的软链接也能用 */
function electronDir() {
  const desktopRequire = createRequire(path.join(DESKTOP, 'package.json'));
  try {
    return path.dirname(desktopRequire.resolve('electron/package.json'));
  } catch {
    throw new Error('没装 electron，先在仓库根目录跑一次 pnpm install');
  }
}

/** dist 里那个可执行文件叫什么，以 electron 自己写的 path.txt 为准 */
export function electronBinaryPath(dir = electronDir()) {
  const fallback = process.platform === 'win32' ? 'electron.exe' : 'electron';
  const marker = path.join(dir, 'path.txt');
  let relative = fallback;
  if (fs.existsSync(marker)) relative = fs.readFileSync(marker, 'utf8').trim() || fallback;
  return path.join(dir, 'dist', relative);
}

export function hasElectronRuntime(dir = electronDir()) {
  return fs.existsSync(electronBinaryPath(dir));
}

/** 缺运行时就用 electron 自带的 install.js 下载；返回是否可用 */
export function ensureElectronRuntime({ force = false, quiet = false } = {}) {
  const dir = electronDir();
  if (!force && hasElectronRuntime(dir)) return true;

  const installer = path.join(dir, 'install.js');
  if (!fs.existsSync(installer)) throw new Error(`electron 包结构变了：找不到 ${installer}`);
  if (!quiet) console.log('[electron] 缺少运行时，开始下载（约 100 MB，只需一次）…');

  const result = spawnSync(process.execPath, [installer], { cwd: dir, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Electron 运行时下载失败（退出码 ${result.status}）`);
  if (!hasElectronRuntime(dir)) throw new Error('Electron 运行时下载后仍不可用，检查 dist/ 目录');
  return true;
}

const invokedDirectly =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);

if (invokedDirectly) {
  try {
    ensureElectronRuntime({ force: process.argv.includes('--force') });
  } catch (error) {
    console.error(`[electron] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}