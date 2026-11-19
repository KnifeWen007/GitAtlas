import { useState } from 'react';
import type {
  GitActionBody,
  RefRecord,
  RepoStatus,
  SnapshotEntry,
  WorkingFile,
} from '../api.ts';
import { SelectMenu } from './SelectMenu.tsx';

interface OperationPanelProps {
  status: RepoStatus | null;
  branches: RefRecord[];
  snapshots: SnapshotEntry[];
  busy: boolean;
  message: { text: string; tone: 'ok' | 'err' } | null;
  onRun: (body: GitActionBody) => void;
  onRefresh: () => void;
  /** 点文件看差异：staged 决定看暂存区还是工作区 */
  onOpenDiff: (path: string, staged: boolean) => void;
  /** 打开冲突编辑器 */
  onEditConflict: (path: string) => void;
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

export function OperationPanel({
  status,
  branches,
  snapshots,
  busy,
  message,
  onRun,
  onRefresh,
  onOpenDiff,
  onEditConflict,
}: OperationPanelProps) {
  const [branchInput, setBranchInput] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [picked, setPicked] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [pendingDiscard, setPendingDiscard] = useState<string | null>(null);

  const localBranches = branches.filter((ref) => ref.kind === 'branch');
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

  return (
    <section className="card op-panel">
      <div className="card-head">
        <div className="card-title">
          操作台
          <span className="hint">所有改动都直接作用在仓库上</span>
        </div>
        <button className="btn btn-sm" onClick={onRefresh} disabled={busy}>
          刷新状态
        </button>
      </div>

      <div className="card-body op-body">
        {message ? <div className={`op-message ${message.tone}`}>{message.text}</div> : null}

        {status ? (
          <div className="op-status">
            <span className="op-chip branch">{status.branch ?? '游离 HEAD（不在分支上）'}</span>
            {status.ahead > 0 ? <span className="op-chip up">↑ {status.ahead} 待推送</span> : null}
            {status.behind > 0 ? <span className="op-chip down">↓ {status.behind} 待拉取</span> : null}
            <span className={`op-chip ${worktree.tone}`}>{worktree.text}</span>
            {status.operation ? (
              <span className="op-chip bad">正在 {status.operation}</span>
            ) : null}
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
                <button
                  className="op-file-main"
                  onClick={() => onEditConflict(file.path)}
                  title="打开编辑器，清掉冲突标记"
                >
                  <code className="op-code k-conflict">!</code>
                  <span className="op-path">{file.path}</span>
                </button>
                <div className="op-file-actions">
                  <button
                    className="btn btn-xs btn-accent"
                    disabled={busy}
                    onClick={() => onEditConflict(file.path)}
                  >
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
              <button
                className="btn btn-sm btn-ghost"
                disabled={busy}
                onClick={() => run({ action: 'abortMerge' })}
              >
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
              <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run({ action: 'abortMerge' })}>
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
              <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run({ action: 'abortMerge' })}>
                放弃这次操作
              </button>
            </div>
          </div>
        ) : null}

        <div className="op-block">
          <div className="op-block-title">同步</div>
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
        </div>

        <div className="op-block">
          <div className="op-block-title">分支</div>
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
            <button
              className="btn btn-sm"
              disabled={busy || !picked}
              onClick={() => run({ action: 'merge', branch: picked })}
            >
              合并进来
            </button>
            <button
              className="btn btn-sm btn-ghost"
              disabled={busy || !picked}
              onClick={() => run({ action: 'deleteBranch', name: picked })}
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
        </div>

        <div className="op-block">
          <div className="op-block-title">标签</div>
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
        </div>

        {status && dirty > 0 ? (
          <div className="op-block">
            <div className="op-block-title">工作区 · {dirty} 个文件</div>

            {status.staged.map((file) => (
              <div className="op-file" key={`s-${file.path}`}>
                <button
                  className="op-file-main"
                  onClick={() => onOpenDiff(file.path, true)}
                  title="点开看这个文件暂存了什么"
                >
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
                <button
                  className="op-file-main"
                  onClick={() => onOpenDiff(file.path, false)}
                  title="点开看这个文件改了什么"
                >
                  <code className={`op-code k-${file.kind}`}>{kindLabel(file.kind)}</code>
                  <span className="op-path">{file.path}</span>
                </button>
                <div className="op-file-actions">
                  <button
                    className="btn btn-xs"
                    disabled={busy}
                    onClick={() => run({ action: 'stage', paths: [file.path] })}
                  >
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
                <button
                  className="op-file-main"
                  onClick={() => onOpenDiff(file.path, false)}
                  title="点开看这个新文件的内容"
                >
                  <code className="op-code k-untracked">?</code>
                  <span className="op-path">{file.path}</span>
                </button>
                <div className="op-file-actions">
                  <button
                    className="btn btn-xs"
                    disabled={busy}
                    onClick={() => run({ action: 'stage', paths: [file.path] })}
                  >
                    暂存
                  </button>
                </div>
              </div>
            ))}

            <div className="op-buttons op-commit">
              <input
                className="op-input op-input-wide"
                placeholder="提交说明"
                value={commitMessage}
                onChange={(event) => setCommitMessage(event.target.value)}
                disabled={busy}
              />
              <button
                className="btn btn-sm btn-accent"
                disabled={busy || commitMessage.trim().length === 0}
                onClick={() => {
                  run({ action: 'commit', message: commitMessage });
                  setCommitMessage('');
                }}
              >
                提交全部改动
              </button>
            </div>
          </div>
        ) : null}

        {snapshots.length > 0 ? (
          <div className="op-block">
            <div className="op-block-title">
              回滚点
              <span className="hint">合并与回滚前自动留的，随时可以退回</span>
            </div>
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
                    onClick={() => run({ action: 'restore', ref: snapshot.ref })}
                  >
                    恢复到此刻
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
