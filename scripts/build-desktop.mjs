#!/usr/bin/env node
/**
 * GitAtlas 桌面端构建与打包。
 *
 * 用法：
 *   node scripts/build-desktop.mjs --dir       只出未打包目录（最快，先验证）
 *   node scripts/build-desktop.mjs             出便携版 + 安装包
 *   node scripts/build-desktop.mjs --portable  只出便携版
 *   node scripts/build-desktop.mjs --level 6   调 7z 压缩级别（0-9，默认 4）
 *
 * 两个必须遵守的约束（踩过，别改）：
 *
 * 1) 打包必须在**真 Node.js** 里跑。本会话的 `node` 是 Electron 自带的运行时，
 *    electron-builder 在里面读 app.asar 会报 "ENOENT, not found in app.asar"。
 *    脚本开头检测到 process.versions.electron 就自动换真 node 重跑。
 *
 * 2) 用 electron-builder 的编程接口，不要走它的 yargs CLI。yargs 的
 *    isBundledElectron() 一旦看到 process.versions.electron 就以为自己跑在打包好的
 *    Electron 里，于是把 cli.js 路径当成未知参数报错。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureElectronRuntime } from './ensure-electron.mjs';

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), '..');
const DESKTOP = path.join(ROOT, 'apps', 'desktop');
const WEB = path.join(ROOT, 'apps', 'web');
const BUILD = path.join(DESKTOP, 'build');
const OUT = path.join(ROOT, 'release');

/* ---------------- 换真 node 重跑 ---------------- */
if (process.versions.electron) {
  const real = findRealNode();
  if (!real) {
    console.error('[build] 当前 node 是 Electron 自带运行时，无法打包；也找不到可用的真 node.exe。');
    console.error('        请安装 Node.js，或直接运行: "D:\\nodejs\\node.exe" scripts\\build-desktop.mjs');
    process.exit(1);
  }
  console.log(`[build] 检测到 Electron 运行时，改用 ${real} 重跑`);
  const env = { ...process.env, ATLAS_BUILD_REEXEC: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(real, [SELF, ...process.argv.slice(2)], { cwd: ROOT, stdio: 'inherit', env });
  process.exit(r.status == null ? 1 : r.status);
}

function findRealNode() {
  const candidates = [
    'D:\\nodejs\\node.exe',
    path.join(process.env.ProgramFiles || '', 'nodejs', 'node.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'nodejs', 'node.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe'),
  ];
  const where = spawnSync('where', ['node'], { encoding: 'utf8' });
  if (where.status === 0 && where.stdout) {
    candidates.push(
      ...where.stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => /\.exe$/i.test(s)),
    );
  }
  for (const exe of candidates) {
    if (!exe || !fs.existsSync(exe)) continue;
    if (exe.toLowerCase() === process.execPath.toLowerCase()) continue;
    const probe = spawnSync(exe, ['-e', 'process.exit(process.versions.electron ? 1 : 0)'], { stdio: 'ignore' });
    if (probe.status === 0) return exe;
  }
  return null;
}

/* ---------------- 小工具 ---------------- */
const t0 = Date.now();
const marks = [];
const step = (label) => {
  marks.push({ label, at: Date.now() });
  console.log(`\n▸ ${label}`);
};
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

function findPnpmPackage(name, rel) {
  const pnpmDir = path.join(ROOT, 'node_modules', '.pnpm');
  if (!fs.existsSync(pnpmDir)) return null;
  // pnpm 把 scope 的斜杠编码成加号：@electron/asar → @electron+asar@3.x.x
  const prefix = `${name.replace('/', '+')}@`;
  for (const dir of fs.readdirSync(pnpmDir)) {
    if (!dir.startsWith(prefix)) continue;
    const candidate = path.join(pnpmDir, dir, 'node_modules', name, rel);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const rootRequire = createRequire(path.join(ROOT, 'package.json'));
const desktopRequire = createRequire(path.join(DESKTOP, 'package.json'));

/* ---------------- 参数 ---------------- */
const argv = process.argv.slice(2);
const has = (...names) => names.some((n) => argv.includes(n));

const dirOnly = has('--dir');
const wantPortable = has('--portable') || (!dirOnly && !has('--nsis'));
const wantNsis = has('--nsis') || (!dirOnly && !has('--portable'));

let level = '4';
const li = argv.findIndex((a) => a === '--level' || /^--level=\d$/.test(a));
if (li >= 0) {
  level = argv[li].includes('=') ? argv[li].split('=')[1] : argv[li + 1] ?? '';
}
if (has('--store')) level = '0';
if (!/^[0-9]$/.test(level)) {
  console.error(`[build] 压缩级别要 0-9，收到 ${JSON.stringify(level)}`);
  process.exit(1);
}
process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL = level;

/* ---------------- 主流程 ---------------- */
async function main() {
  // 0. Electron 运行时：electron 44 起不在 pnpm install 时下载，缺了打包必失败
  ensureElectronRuntime();
  step('确保 Electron 运行时');

  // 1. 清空产物目录
  fs.rmSync(BUILD, { recursive: true, force: true });
  fs.mkdirSync(BUILD, { recursive: true });
  step('清理构建目录');

  // 2. 前端
  const viteBin = findPnpmPackage('vite', path.join('bin', 'vite.js'));
  if (!viteBin) throw new Error('找不到 vite 的可执行文件');
  run(process.execPath, [viteBin, 'build'], WEB, '前端构建失败');
  step('前端构建（apps/web/dist）');

  // 3. 服务端 → 单文件 CJS
  const esbuild = rootRequire('esbuild');
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'packages', 'server', 'src', 'app.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: path.join(BUILD, 'server.cjs'),
    logLevel: 'warning',
    // Electron 主进程会 require 这个文件，不需要 sourcemap
    sourcemap: false,
  });
  step(`服务端打包（${kb(path.join(BUILD, 'server.cjs'))} KB）`);

  // 4. 前端产物进 desktop/build/web
  fs.cpSync(path.join(WEB, 'dist'), path.join(BUILD, 'web'), { recursive: true });
  step('合并前端静态资源');

  // 5. 图标
  prepareIcon();
  step('准备图标');

  // 6. 打包
  closeRunningBuild();
  // electron-builder 装在 apps/desktop 下，必须从那里解析，不能从根解析
  const builder = desktopRequire('electron-builder');
  const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP, 'package.json'), 'utf8'));

  const options = { projectDir: DESKTOP, config: pkg.build, publish: 'never' };

  if (dirOnly) {
    options.dir = true;
    console.log('打包模式：仅目录（release/win-unpacked，用于快速验证）');
  } else {
    const targets = [];
    if (wantNsis) targets.push('nsis');
    if (wantPortable) targets.push('portable');
    options.targets = builder.Platform.WINDOWS.createTarget(targets, builder.Arch.x64);
    console.log(`打包模式：${targets.join(' + ')}（7z 级别 ${level}）`);
  }

  const artifacts = await builder.build(options);
  step('electron-builder');

  verifyAsar();
  step('asar 自检');

  cleanIntermediates();

  console.log('\n产物：');
  for (const f of artifacts) {
    console.log(`  ${path.basename(f)}  ${(fs.statSync(f).size / 1024 / 1024).toFixed(1)} MB`);
  }

  console.log('\n耗时：');
  marks.forEach((m, i) => {
    const prev = i === 0 ? t0 : marks[i - 1].at;
    console.log(`  ${m.label.padEnd(24, '·')} ${((m.at - prev) / 1000).toFixed(1)}s`);
  });
  console.log(`  ${'合计'.padEnd(22, '·')} ${elapsed()}`);
}

function run(cmd, args, cwd, failMsg) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${failMsg}（退出码 ${r.status}）`);
}

function kb(file) {
  return Math.round(fs.statSync(file).size / 1024);
}

/* ---------------- 图标 ---------------- */
function prepareIcon() {
  const ico = path.join(BUILD, 'icon.ico');
  if (fs.existsSync(ico)) return;

  const png = path.join(BUILD, 'icon.png');
  // 设计稿在 brand/ 下（build/ 被 gitignore，不能指望它一直存在）
  const design = path.join(ROOT, 'brand', 'gitatlas-mark-512.png');
  if (fs.existsSync(design)) {
    fs.copyFileSync(design, png);
    console.log(`  使用 ${path.basename(design)} 作为应用图标`);
    return;
  }
  const script = `
Add-Type -AssemblyName System.Drawing
$size = 512
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)
$bg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,10,14,22))
$g.FillEllipse($bg, 0, 0, $size, $size)
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255,34,211,238), 26)
$g.DrawArc($pen, 96, 96, 320, 320, 120, 300)
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,34,211,238))
$g.FillEllipse($brush, 208, 208, 96, 96)
$bmp.Save('${png.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
`;
  const r = spawnSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'pipe' });
  if (r.status !== 0 || !fs.existsSync(png)) {
    console.warn('  [warn] 图标生成失败，将使用 Electron 默认图标');
    return;
  }

  const icoScript = `
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile('${png.replace(/\\/g, '\\\\')}')
$sizes = @(16,24,32,48,64,128,256)
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$sizes.Count)
$images = @()
foreach ($s in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap($s, $s)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.DrawImage($src, 0, 0, $s, $s)
  $g.Dispose()
  $ms2 = New-Object System.IO.MemoryStream
  $bmp.Save($ms2, [System.Drawing.Imaging.ImageFormat]::Png)
  $images += ,@($s, $ms2.ToArray())
  $bmp.Dispose()
}
foreach ($img in $images) {
  $s = $img[0]; $data = $img[1]
  $bw.Write([Byte]($(if ($s -ge 256) {0} else {$s}))); $bw.Write([Byte]($(if ($s -ge 256) {0} else {$s})))
  $bw.Write([Byte]0); $bw.Write([Byte]0)
  $bw.Write([UInt16]1); $bw.Write([UInt16]32)
  $bw.Write([UInt32]$data.Length); $bw.Write([UInt32]($ms.Position + 22 - $ms.Position))
  $bw.Flush()
}
`;
  // ICO 手工拼装容易出错，直接让 electron-builder 从 png 生成更稳
  void icoScript;
  fs.copyFileSync(png, path.join(BUILD, 'icon.png'));
  console.log(`  已生成 ${path.basename(png)}（${kb(png)} KB），electron-builder 会自行转 ico`);
}

/* ---------------- 打包前后 ---------------- */
function closeRunningBuild() {
  if (!/^win/i.test(process.platform)) return;
  const exe = 'GitAtlas.exe';
  const listed = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${exe}`, '/NH'], { encoding: 'utf8' });
  if (listed.status !== 0 || !listed.stdout || listed.stdout.indexOf('.exe') < 0) return;
  spawnSync('taskkill', ['/F', '/T', '/IM', exe], { stdio: 'ignore' });
  console.log('  旧版本还在运行，已关闭（否则 app.asar 被占用会 EBUSY）');
}

function verifyAsar() {
  const asarPath = path.join(OUT, 'win-unpacked', 'resources', 'app.asar');
  if (!fs.existsSync(asarPath)) {
    throw new Error(`找不到 app.asar：${asarPath}`);
  }

  let list;
  try {
    let asar;
    try {
      asar = desktopRequire('@electron/asar');
    } catch {
      const asarMain = findPnpmPackage('@electron/asar', path.join('lib', 'asar.js'));
      if (!asarMain) throw new Error('找不到 @electron/asar');
      asar = rootRequire(asarMain);
    }
    list = asar.listPackage(asarPath).map((p) => p.replace(/\\/g, '/'));
  } catch (error) {
    console.warn(`  [warn] 跳过 asar 内容自检：${error.message}`);
    return;
  }

  // 主进程真正 require 到的文件，缺一个都是"打包成功、双击必崩"
  const required = ['/main.cjs', '/preload.cjs', '/build/server.cjs', '/build/web/index.html', '/package.json'];
  const missing = required.filter((f) => !list.includes(f));
  if (missing.length) {
    throw new Error(`app.asar 缺少 ${missing.join('、')}（检查 package.json 的 build.files）`);
  }
  console.log(`  asar 自检通过：${list.length} 个条目，主进程依赖齐全`);
}

function cleanIntermediates() {
  if (!fs.existsSync(OUT)) return;
  for (const name of fs.readdirSync(OUT)) {
    if (/\.nsis\.7z$/i.test(name) || /\.__uninstaller\.exe$/i.test(name)) {
      try {
        fs.unlinkSync(path.join(OUT, name));
      } catch {
        /* 占用中就算了，不影响产物 */
      }
    }
  }
}

main().catch((error) => {
  console.error('\n构建失败：', error && error.message ? error.message : error);
  if (error && error.stack) console.error(error.stack);
  process.exit(1);
});
