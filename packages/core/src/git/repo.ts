import { GitReader } from './reader.ts';

export interface RepoProbe {
  root: string;
  name: string;
  isShallow: boolean;
  remoteUrl: string | null;
  headSha: string | null;
  headBranch: string | null;
  defaultBranch: string;
}

export interface RawRef {
  name: string;
  shortName: string;
  targetSha: string;
  /** commit / tag / tree / blob */
  objectType: string;
  lastCommitAt: string | null;
  isHead: boolean;
  kind: 'branch' | 'remote' | 'tag';
}

/** 校验目录是否在 Git 仓库内，并收集基础信息 */
export async function probeRepo(dir: string, gitPath?: string): Promise<RepoProbe> {
  const reader = new GitReader({ cwd: dir, ...(gitPath ? { gitPath } : {}) });

  const inside = await reader.tryRun(['rev-parse', '--is-inside-work-tree']);
  if (inside === null || inside.trim() !== 'true') {
    // 可能是 bare 仓库
    const bare = await reader.tryRun(['rev-parse', '--is-bare-repository']);
    if (bare === null || bare.trim() !== 'true') {
      throw new Error('该路径不是 Git 仓库（既无工作树也非 bare 仓库）');
    }
  }

  const root = (await reader.run(['rev-parse', '--show-toplevel'])).trim();
  const isShallow = (await reader.tryRun(['rev-parse', '--is-shallow-repository']))?.trim() === 'true';
  const remoteUrl = (await reader.tryRun(['remote', 'get-url', 'origin']))?.trim() ?? null;
  const headSha = (await reader.tryRun(['rev-parse', 'HEAD']))?.trim() ?? null;
  const headBranch = (await reader.tryRun(['symbolic-ref', '--short', '-q', 'HEAD']))?.trim() ?? null;

  // 默认分支：origin/HEAD → 当前分支 → main
  let defaultBranch = headBranch ?? 'main';
  const remoteHead = await reader.tryRun(['symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD']);
  if (remoteHead && remoteHead.trim().length > 0) {
    defaultBranch = remoteHead.trim().replace(/^origin\//, '');
  }

  const name = root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? 'repo';

  return { root, name, isShallow, remoteUrl, headSha, headBranch, defaultBranch };
}

/** 列出分支与标签（含当前 HEAD 标记） */
export async function listRefs(reader: GitReader): Promise<RawRef[]> {
  const format = [
    '%(refname)',
    '%(refname:short)',
    '%(objectname)',
    '%(objecttype)',
    '%(committerdate:iso-strict)',
    '%(HEAD)',
  ].join('%00');

  const refs: RawRef[] = [];
  for await (const line of reader.lines(['for-each-ref', `--format=${format}`])) {
    if (line.trim().length === 0) continue;
    const [name = '', shortName = '', targetSha = '', objectType = '', date = '', head = ''] = line.split('\x00');

    let kind: RawRef['kind'];
    if (name.startsWith('refs/heads/')) kind = 'branch';
    else if (name.startsWith('refs/remotes/')) kind = 'remote';
    else if (name.startsWith('refs/tags/')) kind = 'tag';
    else continue;

    // 远端 origin/HEAD 是符号引用，跳过
    if (kind === 'remote' && shortName.endsWith('/HEAD')) continue;

    refs.push({
      name,
      shortName,
      targetSha,
      objectType,
      lastCommitAt: date.length > 0 ? date : null,
      isHead: head.trim() === '*',
      kind,
    });
  }
  return refs;
}

/**
 * 计算分支相对默认分支的领先/落后提交数。
 * `git rev-list --count --left-right base...target` 输出 "left\tright"
 * 其中 left = base 独有（target 落后量），right = target 独有（target 领先量）。
 */
export async function aheadBehind(
  reader: GitReader,
  base: string,
  target: string,
): Promise<{ ahead: number; behind: number } | null> {
  const out = await reader.tryRun(['rev-list', '--count', '--left-right', `${base}...${target}`]);
  if (!out) return null;
  const [left = '0', right = '0'] = out.trim().split(/\s+/);
  const behind = Number(left);
  const ahead = Number(right);
  if (Number.isNaN(ahead) || Number.isNaN(behind)) return null;
  return { ahead, behind };
}
