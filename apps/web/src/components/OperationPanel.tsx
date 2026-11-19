import { useState, type ReactNode } from 'react';
import type {
  GitActionBody,
  RefRecord,
  RemoteInfo,
  RepoStatus,
  SnapshotEntry,
  WorkingFile,
} from '../api.ts';
import type { ConfirmRequest } from './ConfirmDialog.tsx';
import { CommitComposer } from './CommitComposer.tsx';
import { RemotePanel } from './RemotePanel.tsx';
import { SelectMenu } from './SelectMenu.tsx';

const LAYOUT_KEY = 'gitatlas.op.layout';

interface OperationPanelProps {
  status: RepoStatus | null;
  branches: RefRecord[];
  snapshots: SnapshotEntry[];
  remotes: RemoteInfo[];
  busy: boolean;
  onRun: (body: GitActionBody) => void;
  /** 危险操作先过一遍应用内确认框 */
  onConfirm: (request: ConfirmRequest) => void;
  onRefresh: () => void;
  /** 点文件看差异：staged 决定看暂存区还是工作区 */
  onOpenDiff: (path: string, staged: boolean) => void;
  /** 打开冲突编辑器 */
  onEditConflict: (path: string) => void;
}

interface OpSectionProps {
  id: string;
  title: string;
  hint?: string;
  /** 收起时也能看到的数字，比如「3 个文件」 */
  summary?: string;
  open: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
}

function OpSection({ id, title, hint, summary, open, onToggle, children }: OpSectionProps) {
  return (
    <div className={`op-block ${open ? 'is-open' : 'is-closed'}`}>
      <button
        type="button"
        className="op-block-head"
        aria-expanded={open}
        aria-controls={`op-section-${id}`}
        onClick={() => onToggle(id)}
      >
        <span className="op-caret" aria-hidden="true" />
        <span className="op-block-name">{title}</span>
        {hint ? <span className="hint">{hint}</span> : null}
        {summary ? <span className="op-block-sum">{summary}</span> : null}
      </button>
      {open ? (
        <div className="op-block-body" id={`op-section-${id}`}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

function kindLabel(kind: WorkingFile['kind']): string {
  switch (kind) {
    case 'added':
      return 'A';
    case 'deleted':
      return 'D';
    case 'renamed':
      return 'R';
    case 'conflict':
      return '!';
    case 'untracked':
      return '?';
    default:
      return 'M';
  }
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 快照名形如 2026-11-19T07-19-00.976Z —— 冒号被换成横线，毫秒分隔符可能是点也可能是横线，
 * 直接交给 Date 会解析失败，所以按位拆出来再拼成合法 ISO。
 */
function snapshotTime(name: string): string {
  const matched = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})(?:[.-](\d{1,3}))?Z$/.exec(name);
  if (!matched) return name;
  const [, year, month, day, hour, minute, second, ms] = matched;
  const fraction = (ms ?? '0').padEnd(3, '0');
  return formatTime(`${year}-${month}-${day}T${hour}:${minute}:${second}.${fraction}Z`);
}

function readLayout(): 'one' | 'all' {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'all' ? 'all' : 'one';
  } catch {
    return 'one';
  }
}

export function OperationPanel({
  status,
  branches,
  snapshots,
  remotes,
  busy,
  onRun,
  onConfirm,
  onRefresh,
  onOpenDiff,
  onEditConflict,
}: OperationPanelProps) {
  const [branchInput, setBranchInput] = useState('');
  const [renameInput, setRenameInput] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [picked, setPicked] = useState('');
  const [pickedTag, setPickedTag] = useState('');
  const [pendingDiscard, setPendingDiscard] = useState<string | null>(null);

  /** 单开 / 全部展开；默认单开，点一个开一个 */
  const [layout, setLayout] = useState<'one' | 'all'>(readLayout);
  /** 默认全部收起：操作台先当状态栏看，要用哪块再点开，图谱才是首屏主角 */
  const [openId, setOpenId] = useState<string>('');
  const [closed, setClosed] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    if (layout === 'one') {
      setOpenId((current) => (current === id ? '' : id));
      return;
    }
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isOpen = (id: string) => (layout === 'one' ? openId === id : !closed.has(id));

  const switchLayout = (next: 'one' | 'all') => {
    setLayout(next);
    setClosed(new Set());
    if (next === 'all') setOpenId('');
    else setOpenId('sync');
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // 记不住就记不住，不影响使用
    }
  };

  const localBranches = branches.filter((ref) => ref.kind === 'branch');
  const tags = branches.filter((ref) => ref.kind === 'tag');
  const others = localBranches.filter((ref) => ref.shortName !== status?.branch);
  const conflicts = status?.conflicts ?? [];
  /** 合并/变基等操作还在进行中；冲突清空后仍要留一个收尾入口 */
  const operation = status?.operation ?? null;
  const tracked = status ? status.staged.length + status.unstaged.length : 0;
  const untracked = status?.untracked.length ?? 0;
  const dirty = tracked + untracked;

  /**
   * clean 沿用 git 的口径：只看已跟踪文件。未跟踪文件不算"改动"，
   * 但既然下面会把它们列出来，徽标就不能写"干净"，否则自相矛盾。
   */
  const worktree = (() => {
    if (!status) return { tone: '', text: '正在读取状态' };
    if (conflicts.length > 0) return { tone: 'bad', text: `${conflicts.length} 个冲突待处理` };
    if (tracked > 0) return { tone: 'warn', text: `${dirty} 个文件有改动` };
    if (untracked > 0) return { tone: 'warn', text: `${untracked} 个未跟踪文件` };
    return { tone: 'ok', text: '工作区干净' };
  })();

  const run = (body: GitActionBody) => {
    setPendingDiscard(null);
    onRun(body);
  };

  /** 会让提交图挪位置的三个操作，先让人看清楚代价 */
  const askAbort = () =>
    onConfirm({
      title: '放弃这次操作？',
      body: '合并 / 变基 / 拣选进行中的改动会回到开始之前，已经自动留下的回滚点不会丢。',
      confirmLabel: '放弃',
      danger: true,
      onConfirm: () => run({ action: 'abortMerge' }),
    });

  const askDeleteBranch = () =>
    onConfirm({
      title: `删除分支 ${picked}？`,
      body: '分支名会立刻消失。分支上的提交本身还在仓库里，但之后要靠提交号才找得回来。',
      confirmLabel: '删除分支',
      danger: true,
      onConfirm: () => run({ action: 'deleteBranch', name: picked }),
    });

  const askDeleteTag = () =>
    onConfirm({
      title: `删除标签 ${pickedTag}？`,
      body: '标签只是给某个提交起的名字，删掉不会影响提交内容，但别人就看不到这个版本号了。',
      confirmLabel: '删除标签',
      danger: true,
      onConfirm: () => {
        run({ action: 'deleteTag', name: pickedTag });
        setPickedTag('');
      },
    });

  const askRestore = (snapshot: SnapshotEntry) =>
    onConfirm({
      title: '回到这个回滚点？',
      body: `当前分支会指回 ${snapshot.sha.slice(0, 7)} 这个备份。之后的提交还能从提交号找回来，但图谱上的位置会变。`,
      confirmLabel: '回到这个回滚点',
      danger: true,
      onConfirm: () => run({ action: 'restore', ref: snapshot.ref }),
    });

  const syncSummary = status
    ? [status.ahead > 0 ? `↑${status.ahead}` : '', status.behind > 0 ? `↓${status.behind}` : '']
        .filter(Boolean)
        .join(' ')
    : '';

  return (
    <section className="card op-panel">
      <div className="card-head">
        <div className="card-title">
          <span className="card-name">操作台</span>
          <span className="hint">点标题展开一个模块，也可以全部摊开</span>
        </div>
        <div className="op-head-tools">
          <div className="op-layout" role="group" aria-label="操作台展开方式">
            <button
              type="button"
              className={layout === 'one' ? 'is-on' : ''}
              aria-pressed={layout === 'one'}
              onClick={() => switchLayout('one')}
            >
              逐个看
            </button>
            <button
              type="button"
              className={layout === 'all' ? 'is-on' : ''}
              aria-pressed={layout === 'all'}
              onClick={() => switchLayout('all')}
            >
              全部展开
            </button>
          </div>
          <button className="btn btn-sm" onClick={onRefresh} disabled={busy}>
            刷新状态
          </button>
        </div>
      </div>

      <div className="card-body op-body">
        {status ? (
          <div className="op-status">
            <span className="op-chip branch">{status.branch ?? '游离 HEAD（不在分支上）'}</span>
            {status.ahead > 0 ? <span className="op-chip up">↑ {status.ahead} 待推送</span> : null}
            {status.behind > 0 ? <span className="op-chip down">↓ {status.behind} 待拉取</span> : null}
            <span className={`op-chip ${worktree.tone}`}>{worktree.text}</span>
            {status.operation ? <span className="op-chip bad">正在 {status.operation}</span> : null}
            {status.stashCount > 0 ? <span className="op-chip">{status.stashCount} 个暂存</span> : null}
            {!status.remoteUrl ? <span className="op-chip">未配置远端</span> : null}
          </div>
        ) : (
          <div className="empty-desc">正在读取仓库状态…</div>
        )}

        {conflicts.length > 0 ? (
          <div className="op-block op-block-alert">
            <div className="op-block-title">
              冲突 · {conflicts.length} 个文件
              <span className="hint">点文件名可以在这里直接改，也可以一键选一边</span>
            </div>
            {conflicts.map((file) => (
              <div className="op-file" key={file.path}>
                <button className="op-file-main" onClick={() => onEditConflict(file.path)} title="打开编辑器，清掉冲突标记">
                  <code className="op-code k-conflict">!</code>
                  <span className="op-path">{file.path}</span>
                </button>
                <div className="op-file-actions">
                  <button className="btn btn-xs btn-accent" disabled={busy} onClick={() => onEditConflict(file.path)}>
                    编辑
                  </button>
                  <button
                    className="btn btn-xs"
                    disabled={busy}
                    onClick={() => run({ action: 'resolveConflict', path: file.path, side: 'ours' })}
                  >
                    留本地
                  </button>
                  <button
                    className="btn btn-xs"
                    disabled={busy}
                    onClick={() => run({ action: 'resolveConflict', path: file.path, side: 'theirs' })}
                  >
                    留对方
                  </button>
                </div>
              </div>
            ))}
            <div className="op-buttons">
              <button className="btn btn-sm" disabled={busy} onClick={() => run({ action: 'concludeMerge' })}>
                都处理完了，完成合并
              </button>
              <button className="btn btn-sm btn-ghost" disabled={busy} onClick={askAbort}>
                放弃这次合并
              </button>
            </div>
          </div>
        ) : null}

        {conflicts.length === 0 && operation === 'merge' ? (
          <div className="op-block op-block-alert">
            <div className="op-block-title">
              合并进行中
              <span className="hint">冲突都处理完了，只差最后一步提交；也可以放弃这次合并</span>
            </div>
            <div className="op-buttons">
              <button className="btn btn-sm btn-accent" disabled={busy} onClick={() => run({ action: 'concludeMerge' })}>
                提交合并结果
              </button>
              <button className="btn btn-sm btn-ghost" disabled={busy} onClick={askAbort}>
                放弃这次合并
              </button>
            </div>
          </div>
        ) : null}

        {conflicts.length === 0 && operation !== 'merge' && operation !== null ? (
          <div className="op-block">
            <div className="op-block-title">
              {operation === 'rebase' ? '变基进行中' : operation === 'cherry-pick' ? '拣选进行中' : '回退进行中'}
              <span className="hint">这一步还没收尾，处理完冲突后需要继续或放弃</span>
            </div>
            <div className="op-buttons">
              <button className="btn btn-sm btn-ghost" disabled={busy} onClick={askAbort}>
                放弃这次操作
              </button>
            </div>
          </div>
        ) : null}

        <div className="op-sections">
        <OpSection
          id="sync"
          title="同步"
          hint="和远端仓库对一次账"
          summary={syncSummary}
          open={isOpen('sync')}
          onToggle={toggle}
        >
          <div className="op-buttons">
            <button className="btn btn-sm" disabled={busy} onClick={() => run({ action: 'fetch' })}>
              获取远端
            </button>
            <button className="btn btn-sm" disabled={busy} onClick={() => run({ action: 'pull' })}>
              拉取并合并
            </button>
            <button className="btn btn-sm" disabled={busy} onClick={() => run({ action: 'push' })}>
              推送
            </button>
          </div>
          {status && !status.upstream && status.branch ? (
            <div className="hint">这个分支还没接上游，第一次推送会自动接上 origin。</div>
          ) : null}
          <div className="op-buttons op-sub">
            <button
              className="btn btn-sm btn-ghost"
              disabled={busy || dirty === 0}
              onClick={() => run({ action: 'stash' })}
              title="把当前改动收进 stash，工作区变干净，随时能取回来"
            >
              暂存改动
            </button>
            <button
              className="btn btn-sm btn-ghost"
              disabled={busy || (status?.stashCount ?? 0) === 0}
              onClick={() => run({ action: 'stashPop' })}
              title="取回最近一次收起的改动"
            >
              取回暂存{status?.stashCount ? `（${status.stashCount}）` : ''}
            </button>
          </div>
        </OpSection>

        <OpSection
          id="remote"
          title="远端"
          hint="地址随时能改"
          summary={remotes.length > 0 ? `${remotes.length} 个` : '未配置'}
          open={isOpen('remote')}
          onToggle={toggle}
        >
          <RemotePanel remotes={remotes} busy={busy} onRun={run} />
        </OpSection>

        <OpSection
          id="branch"
          title="分支"
          hint="切换、新建、合并、改名"
          summary={`${localBranches.length} 条`}
          open={isOpen('branch')}
          onToggle={toggle}
        >
          <div className="op-buttons">
            <SelectMenu
              className="op-select"
              value={picked}
              onChange={setPicked}
              disabled={busy || others.length === 0}
              placeholder={others.length > 0 ? '选一个分支…' : '没有其他本地分支'}
              ariaLabel="选择分支"
              options={others.map((ref) => ({ value: ref.shortName, label: ref.shortName }))}
            />
            <button
              className="btn btn-sm"
              disabled={busy || !picked}
              onClick={() => run({ action: 'checkout', branch: picked })}
            >
              切换过去
            </button>
            <button className="btn btn-sm" disabled={busy || !picked} onClick={() => run({ action: 'merge', branch: picked })}>
              合并进来
            </button>
            <button
              className="btn btn-sm btn-ghost"
              disabled={busy || !picked}
              onClick={askDeleteBranch}
            >
              删除
            </button>
          </div>

          <div className="op-buttons">
            <input
              className="op-input"
              placeholder="新分支名"
              value={branchInput}
              onChange={(event) => setBranchInput(event.target.value)}
              disabled={busy}
            />
            <button
              className="btn btn-sm"
              disabled={busy || branchInput.trim().length === 0}
              onClick={() => {
                run({ action: 'createBranch', name: branchInput, target: status?.headSha ?? undefined });
                setBranchInput('');
              }}
            >
              新建并留在当前
            </button>
          </div>

          <div className="op-buttons">
            <input
              className="op-input"
              placeholder={`把 ${status?.branch ?? '当前分支'} 改名为`}
              value={renameInput}
              onChange={(event) => setRenameInput(event.target.value)}
              disabled={busy || !status?.branch}
            />
            <button
              className="btn btn-sm"
              disabled={busy || !status?.branch || renameInput.trim().length === 0}
              onClick={() => {
                run({ action: 'renameBranch', name: status?.branch ?? '', target: renameInput.trim() });
                setRenameInput('');
              }}
            >
              改名
            </button>
          </div>
        </OpSection>

        <OpSection
          id="tag"
          title="标签"
          hint="给某次提交钉个名字"
          summary={`${tags.length} 个`}
          open={isOpen('tag')}
          onToggle={toggle}
        >
          <div className="op-buttons">
            <input
              className="op-input"
              placeholder="标签名，如 v1.0.0"
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              disabled={busy}
            />
            <button
              className="btn btn-sm"
              disabled={busy || tagInput.trim().length === 0}
              onClick={() => {
                run({ action: 'tag', name: tagInput });
                setTagInput('');
              }}
            >
              在当前提交打标签
            </button>
          </div>

          <div className="op-buttons">
            <SelectMenu
              className="op-select"
              value={pickedTag}
              onChange={setPickedTag}
              disabled={busy || tags.length === 0}
              placeholder={tags.length > 0 ? '选一个标签…' : '还没有标签'}
              ariaLabel="选择标签"
              options={tags.map((ref) => ({ value: ref.shortName, label: ref.shortName }))}
            />
            <button
              className="btn btn-sm btn-ghost"
              disabled={busy || !pickedTag}
              onClick={askDeleteTag}
            >
              删除标签
            </button>
          </div>
        </OpSection>

        {status ? (
          <OpSection
            id="commit"
            title="提交"
            hint="按 Conventional Commits 写"
            summary={dirty > 0 ? `${dirty} 个改动` : '工作区干净'}
            open={isOpen('commit')}
            onToggle={toggle}
          >
            <CommitComposer status={status} busy={busy} onRun={run} />
          </OpSection>
        ) : null}

        {status && dirty > 0 ? (
          <OpSection
            id="worktree"
            title="工作区"
            hint="点文件名看差异，逐行决定去留"
            summary={`${dirty} 个文件`}
            open={isOpen('worktree')}
            onToggle={toggle}
          >
            {status.staged.map((file) => (
              <div className="op-file" key={`s-${file.path}`}>
                <button className="op-file-main" onClick={() => onOpenDiff(file.path, true)} title="点开看这个文件暂存了什么">
                  <code className="op-code k-staged">{kindLabel(file.kind)}</code>
                  <span className="op-path">{file.path}</span>
                </button>
                <div className="op-file-actions">
                  <button
                    className="btn btn-xs btn-ghost"
                    disabled={busy}
                    onClick={() => run({ action: 'unstage', paths: [file.path] })}
                  >
                    取消暂存
                  </button>
                </div>
              </div>
            ))}

            {status.unstaged.map((file) => (
              <div className="op-file" key={`u-${file.path}`}>
                <button className="op-file-main" onClick={() => onOpenDiff(file.path, false)} title="点开看这个文件改了什么">
                  <code className={`op-code k-${file.kind}`}>{kindLabel(file.kind)}</code>
                  <span className="op-path">{file.path}</span>
                </button>
                <div className="op-file-actions">
                  <button className="btn btn-xs" disabled={busy} onClick={() => run({ action: 'stage', paths: [file.path] })}>
                    暂存
                  </button>
                  {pendingDiscard === file.path ? (
                    <button
                      className="btn btn-xs btn-danger"
                      disabled={busy}
                      onClick={() => run({ action: 'discard', paths: [file.path] })}
                    >
                      确认丢弃
                    </button>
                  ) : (
                    <button
                      className="btn btn-xs btn-ghost"
                      disabled={busy}
                      onClick={() => setPendingDiscard(file.path)}
                    >
                      丢弃
                    </button>
                  )}
                </div>
              </div>
            ))}

            {status.untracked.map((file) => (
              <div className="op-file" key={`n-${file.path}`}>
                <button className="op-file-main" onClick={() => onOpenDiff(file.path, false)} title="点开看这个新文件的内容">
                  <code className="op-code k-untracked">?</code>
                  <span className="op-path">{file.path}</span>
                </button>
                <div className="op-file-actions">
                  <button className="btn btn-xs" disabled={busy} onClick={() => run({ action: 'stage', paths: [file.path] })}>
                    暂存
                  </button>
                </div>
              </div>
            ))}
          </OpSection>
        ) : null}

        {snapshots.length > 0 ? (
          <OpSection
            id="snapshot"
            title="回滚点"
            hint="合并与回滚前自动留的，随时可以退回"
            summary={`${snapshots.length} 个`}
            open={isOpen('snapshot')}
            onToggle={toggle}
          >
            {snapshots.slice(0, 5).map((snapshot) => (
              <div className="op-file" key={snapshot.ref}>
                <code className="op-code sha">{snapshot.sha.slice(0, 7)}</code>
                <span className="op-path" title={`快照 ${snapshot.name}`}>
                  备份于 {snapshotTime(snapshot.name)}
                </span>
                <div className="op-file-actions">
                  <button
                    className="btn btn-xs btn-ghost"
                    disabled={busy}
                    onClick={() => askRestore(snapshot)}
                  >
                    恢复到此刻
                  </button>
                </div>
              </div>
            ))}
          </OpSection>
        ) : null}
        </div>
      </div>
    </section>
  );
}
