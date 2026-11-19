/**
 * 找齐所有 *.test.ts 再交给 node --test。
 *
 * 直接 `node --test 目录` 在 Windows 上会把目录当模块去 require，
 * 而 shell 又不会替我们展开 `**`，所以自己走一遍目录。
 * node 24 能直接跑 .ts，类型擦除由运行时负责，不需要额外编译。
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['apps/web/src', 'packages/core/src', 'packages/server/src'];
const files = [];

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      walk(full);
    } else if (/\.test\.tsx?$/.test(entry)) {
      files.push(full);
    }
  }
}

for (const root of ROOTS) walk(root);

if (files.length === 0) {
  console.error('没有找到测试文件（*.test.ts）');
  process.exit(1);
}

console.log(`跑 ${files.length} 个测试文件：`);
for (const file of files) console.log(`  ${file}`);

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
