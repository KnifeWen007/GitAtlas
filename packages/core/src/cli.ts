#!/usr/bin/env node
/**
 * 开发/运维用的 CLI（产品界面本身不需要命令行，这是给工程与服务器用的）。
 *
 *   node packages/core/src/cli.ts index <repoPath> [--db <path>] [--git <path>]
 *   node packages/core/src/cli.ts list [--db <path>]
 *   node packages/core/src/cli.ts timeline <repoId> [--days 371]
 *   node packages/core/src/cli.ts doctor
 */
import { resolve } from 'node:path';
import { Store } from './store/db.ts';
import { indexRepo } from './index/indexer.ts';
import { listRepos, getRepo } from './store/repos.ts';
import { getTimeline, getSummary } from './analytics/queries.ts';
import { probeGit } from './git/reader.ts';

const DEFAULT_DB = resolve(process.cwd(), 'data', 'atlas.db');

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function positional(index: number): string | undefined {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  return args[index];
}

async function main(): Promise<void> {
  const command = positional(0) ?? 'help';
  const dbPath = arg('db') ?? DEFAULT_DB;
  const gitPath = arg('git');

  if (command === 'doctor') {
    const probe = await probeGit(gitPath);
    console.log(JSON.stringify({ git: probe, dbPath }, null, 2));
    return;
  }

  const store = new Store(dbPath);
  try {
    if (command === 'index') {
      const target = positional(1);
      if (!target) throw new Error('用法：index <repoPath>');

      const result = await indexRepo(store, {
        repoPath: resolve(target),
        ...(gitPath ? { gitPath } : {}),
        onProgress: (p) => {
          if (p.phase === 'commits' && p.processed % 5000 !== 0) return;
          process.stderr.write(`[${p.phase}] ${p.message}\n`);
        },
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (command === 'list') {
      console.log(JSON.stringify(listRepos(store), null, 2));
      return;
    }

    if (command === 'timeline') {
      const id = Number(positional(1));
      if (!Number.isFinite(id)) throw new Error('用法：timeline <repoId>');
      console.log(JSON.stringify(getSummary(store, id), null, 2));
      const timeline = getTimeline(store, id, Number(arg('days') ?? 371));
      console.log(`days=${timeline.days.length} commits=${timeline.totals.commits} activeDays=${timeline.totals.activeDays}`);
      return;
    }

    if (command === 'show') {
      const id = Number(positional(1));
      const repo = getRepo(store, id);
      console.log(JSON.stringify(repo ?? null, null, 2));
      return;
    }

    console.log(`GitAtlas core CLI
  index <repoPath>   索引一个仓库
  list               列出已索引仓库
  timeline <repoId>  打印时间轴统计
  show <repoId>      打印仓库记录
  doctor             环境体检

全局参数：--db <path>  --git <path>`);
  } finally {
    store.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
