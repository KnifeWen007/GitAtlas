import { useTranslation } from '../i18n.ts';
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

/** 记住上次看的是哪一块；下次打开同一个模块，省一次点击 */
const TAB_KEY = 'gitatlas.op.tab';

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

type ModuleId = 'sync' | 'branch' | 'commit' | 'worktree' | 'remote' | 'tag' | 'snapshot';

interface ModuleDef {
  id: ModuleId;
  title: string;
  /** 选中后标题行里的那句说明 */
  hint: string;
  /** 按钮上跟着名字的小数字，如「3 个」；没有就不显示 */
  summary?: string;
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

function readTab(): ModuleId | null {
  try {
    const stored = localStorage.getItem(TAB_KEY);
    return stored ? (stored as ModuleId) : null;
  } catch {
    return null;
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
  const { t } = useTranslation();
  const [branchInput, setBranchInput] = useState('');
  const [renameInput, setRenameInput] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [picked, setPicked] = useState('');
  const [pickedTag, setPickedTag] = useState('');
  const [pendingDiscard, setPendingDiscard] = useState<string | null>(null);

  /** 当前看哪一块；默认同步——最常来的地方 */
  const [active, setActive] = useState<ModuleId>(() => readTab() ?? 'sync');

  const select = (id: ModuleId) => {
    setActive(id);
    try {
      localStorage.setItem(TAB_KEY, id);
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
    if (!status) return { tone: '', text: t("正在读取状态") };
    if (conflicts.length > 0) return { tone: 'bad', text: t("{0} 个冲突待处理", conflicts.length) };
    if (tracked > 0) return { tone: 'warn', text: t("{0} 个文件有改动", dirty) };
    if (untracked > 0) return { tone: 'warn', text: t("{0} 个未跟踪文件", untracked) };
    return { tone: 'ok', text: t("工作区干净") };
  })();

  const run = (body: GitActionBody) => {
    setPendingDiscard(null);
    onRun(body);
  };

  /** 会让提交图挪位置的三个操作，先让人看清楚代价 */
  const askAbort = () =>
    onConfirm({
      title: t("放弃这次操作？"),
      body: t("合并 / 变基 / 拣选进行中的改动会回到开始之前，已经自动留下的回滚点不会丢。"),
      confirmLabel: t("放弃"),
      danger: true,
      onConfirm: () => run({ action: 'abortMerge' }),
    });

  const askDeleteBranch = () =>
    onConfirm({
      title: t("删除分支 {0}？", picked),
      body: t("分支名会立刻消失。分支上的提交本身还在仓库里，但之后要靠提交号才找得回来。"),
      confirmLabel: t("删除分支"),
      danger: true,
      onConfirm: () => run({ action: 'deleteBranch', name: picked }),
    });

  const askDeleteTag = () =>
    onConfirm({
      title: t("删除标签 {0}？", pickedTag),
      body: t("标签只是给某个提交起的名字，删掉不会影响提交内容，但别人就看不到这个版本号了。"),
      confirmLabel: t("删除标签"),
      danger: true,
      onConfirm: () => {
        run({ action: 'deleteTag', name: pickedTag });
        setPickedTag('');
      },
    });

  const askRestore = (snapshot: SnapshotEntry) =>
    onConfirm({
      title: t("回到这个回滚点？"),
      body: t("当前分支会指回 {0} 这个备份。之后的提交还能从提交号找回来，但图谱上的位置会变。", snapshot.sha.slice(0, 7)),
      confirmLabel: t("回到这个回滚点"),
      danger: true,
      onConfirm: () => run({ action: 'restore', ref: snapshot.ref }),
    });

  const syncSummary = status
    ? [status.ahead > 0 ? `↑${status.ahead}` : '', status.behind > 0 ? `↓${status.behind}` : '']
        .filter(Boolean)
        .join(' ')
    : '';

  /** 一排按钮：顺序固定，当前情况下没内容的模块直接不出现 */
  const modules: ModuleDef[] = [
    { id: 'sync', title: t("同步"), hint: t("和远端仓库对一次账"), ...(syncSummary ? { summary: syncSummary } : {}) },
    { id: 'branch', title: t("分支"), hint: t("切换、新建、合并、改名"), summary: t("{0} 条", localBranches.length) },
    ...(status
      ? [
          {
            id: 'commit' as ModuleId,
            title: t("提交"),
            hint: t("按 Conventional Commits 写"),
            summary: dirty > 0 ? t("{0} 个改动", dirty) : t("工作区干净"),
          },
        ]
      : []),
    ...(status && dirty > 0
      ? [
          {
            id: 'worktree' as ModuleId,
            title: t("工作区"),
            hint: t("点文件名看差异，逐行决定去留"),
            summary: t("{0} 个文件", dirty),
          },
        ]
      : []),
    {
      id: 'remote',
      title: t("远端"),
      hint: t("地址随时能改"),
      summary: remotes.length > 0 ? t("{0} 个", remotes.length) : t("未配置"),
    },
    { id: 'tag', title: t("标签"), hint: t("给某次提交钉个名字"), summary: t("{0} 个", tags.length) },
    ...(snapshots.length > 0
      ? [
          {
            id: 'snapshot' as ModuleId,
            title: t("回滚点"),
            hint: t("合并与回滚前自动留的，随时可以退回"),
            summary: t("{0} 个", snapshots.length),
          },
        ]
      : []),
  ];

  // 上次停在「工作区」，这次工作区干净了：退回第一块，别留一个点不亮的选中态
  const current = modules.find((module) => module.id === active) ?? modules[0] ?? {
    id: 'sync' as ModuleId,
    title: t("同步"),
    hint: t("和远端仓库对一次账"),
  };

  const body = (id: ModuleId): ReactNode => {
    switch (id) {
      case 'sync':
        return (
          <>
            <div className="op-buttons">
              <button className="btn btn-sm" disabled={busy} onClick={() => run({ action: 'fetch' })}>
                {t("获取远端")}
              </button>
              <button className="btn btn-sm" disabled={busy} onClick={() => run({ action: 'pull' })}>
                {t("拉取并合并")}
              </button>
              <button className="btn btn-sm" disabled={busy} onClick={() => run({ action: 'push' })}>
                {t("推送")}
              </button>
            </div>
            {status && !status.upstream && status.branch ? (
              <div className="hint">{t("这个分支还没接上游，第一次推送会自动接上 origin。")}</div>
            ) : null}
            <div className="op-buttons op-sub">
              <button
                className="btn btn-sm btn-ghost"
                disabled={busy || dirty === 0}
                onClick={() => run({ action: 'stash' })}
                title={t("把当前改动收进 stash，工作区变干净，随时能取回来")}
              >
                {t("暂存改动")}
              </button>
              <button
                className="btn btn-sm btn-ghost"
                disabled={busy || (status?.stashCount ?? 0) === 0}
                onClick={() => run({ action: 'stashPop' })}
                title={t("取回最近一次收起的改动")}
              >
                {t("取回暂存")}{status?.stashCount ? `（${status.stashCount}）` : ''}
              </button>
            </div>
          </>
        );

      case 'branch':
        return (
          <>
            <div className="op-buttons">
              <SelectMenu
                className="op-select"
                value={picked}
                onChange={setPicked}
                disabled={busy || others.length === 0}
                placeholder={others.length > 0 ? t("选一个分支…") : t("没有其他本地分支")}
                ariaLabel={t("选择分支")}
                options={others.map((ref) => ({ value: ref.shortName, label: ref.shortName }))}
              />
              <button
                className="btn btn-sm"
                disabled={busy || !picked}
                onClick={() => run({ action: 'checkout', branch: picked })}
              >
                {t("切换过去")}
              </button>
              <button
                className="btn btn-sm"
                disabled={busy || !picked}
                onClick={() => run({ action: 'merge', branch: picked })}
              >
                {t("合并进来")}
              </button>
              <button className="btn btn-sm btn-ghost" disabled={busy || !picked} onClick={askDeleteBranch}>
                {t("删除")}
              </button>
            </div>

            <div className="op-buttons">
              <input
                className="op-input"
                placeholder={t("新分支名")}
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
                {t("新建并留在当前")}
              </button>
            </div>

            <div className="op-buttons">
              <input
                className="op-input"
                placeholder={t("把 {0} 改名为", status?.branch ?? '当前分支')}
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
                {t("改名")}
              </button>
            </div>
          </>
        );

      case 'commit':
        return status ? <CommitComposer status={status} busy={busy} onRun={run} /> : null;

      case 'worktree':
        if (!status) return null;
        return (
          <>
            {status.staged.map((file) => (
              <div className="op-file" key={`s-${file.path}`}>
                <button
                  className="op-file-main"
                  onClick={() => onOpenDiff(file.path, true)}
                  title={t("点开看这个文件暂存了什么")}
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
                    {t("取消暂存")}
                  </button>
                </div>
              </div>
            ))}

            {status.unstaged.map((file) => (
              <div className="op-file" key={`u-${file.path}`}>
                <button
                  className="op-file-main"
                  onClick={() => onOpenDiff(file.path, false)}
                  title={t("点开看这个文件改了什么")}
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
                    {t("暂存")}
                  </button>
                  {pendingDiscard === file.path ? (
                    <button
                      className="btn btn-xs btn-danger"
                      disabled={busy}
                      onClick={() => run({ action: 'discard', paths: [file.path] })}
                    >
                      {t("确认丢弃")}
                    </button>
                  ) : (
                    <button
                      className="btn btn-xs btn-ghost"
                      disabled={busy}
                      onClick={() => setPendingDiscard(file.path)}
                    >
                      {t("丢弃")}
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
                  title={t("点开看这个新文件的内容")}
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
                    {t("暂存")}
                  </button>
                </div>
              </div>
            ))}
          </>
        );

      case 'remote':
        return <RemotePanel remotes={remotes} busy={busy} onRun={run} />;

      case 'tag':
        return (
          <>
            <div className="op-buttons">
              <input
                className="op-input"
                placeholder={t("标签名，如 v1.0.0")}
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
                {t("在当前提交打标签")}
              </button>
            </div>

            <div className="op-buttons">
              <SelectMenu
                className="op-select"
                value={pickedTag}
                onChange={setPickedTag}
                disabled={busy || tags.length === 0}
                placeholder={tags.length > 0 ? t("选一个标签…") : t("还没有标签")}
                ariaLabel={t("选择标签")}
                options={tags.map((ref) => ({ value: ref.shortName, label: ref.shortName }))}
              />
              <button className="btn btn-sm btn-ghost" disabled={busy || !pickedTag} onClick={askDeleteTag}>
                {t("删除标签")}
              </button>
            </div>
          </>
        );

      case 'snapshot':
        return (
          <>
            {snapshots.slice(0, 5).map((snapshot) => (
              <div className="op-file" key={snapshot.ref}>
                <code className="op-code sha">{snapshot.sha.slice(0, 7)}</code>
                <span className="op-path" title={t("快照 {0}", snapshot.name)}>
                  {t("备份于")} {snapshotTime(snapshot.name)}
                </span>
                <div className="op-file-actions">
                  <button className="btn btn-xs btn-ghost" disabled={busy} onClick={() => askRestore(snapshot)}>
                    {t("恢复到此刻")}
                  </button>
                </div>
              </div>
            ))}
          </>
        );

      default:
        return null;
    }
  };

  return (
    <section className="card op-panel">
      <div className="card-head">
        <div className="card-title">
          <span className="card-name">{t("操作台")}</span>
          <span className="hint">{t("点上面的按钮切换模块，一次只看一块")}</span>
        </div>
        <div className="op-head-tools">
          <button className="btn btn-sm" onClick={onRefresh} disabled={busy}>
            {t("刷新状态")}
          </button>
        </div>
      </div>

      <div className="card-body op-body">
        {status ? (
          <div className="op-status">
            <span className="op-chip branch">{status.branch ?? t("游离 HEAD（不在分支上）")}</span>
            {status.ahead > 0 ? <span className="op-chip up">↑ {status.ahead} {t("待推送")}</span> : null}
            {status.behind > 0 ? <span className="op-chip down">↓ {status.behind} {t("待拉取")}</span> : null}
            <span className={`op-chip ${worktree.tone}`}>{worktree.text}</span>
            {status.operation ? <span className="op-chip bad">{t("正在")} {status.operation}</span> : null}
            {status.stashCount > 0 ? <span className="op-chip">{status.stashCount} {t("个暂存")}</span> : null}
            {!status.remoteUrl ? <span className="op-chip">{t("未配置远端")}</span> : null}
          </div>
        ) : (
          <div className="empty-desc">{t("正在读取仓库状态…")}</div>
        )}

        {conflicts.length > 0 ? (
          <div className="op-block op-block-alert">
            <div className="op-block-title">
              {t("冲突 ·")} {conflicts.length} {t("个文件")}
              <span className="hint">{t("点文件名可以在这里直接改，也可以一键选一边")}</span>
            </div>
            {conflicts.map((file) => (
              <div className="op-file" key={file.path}>
                <button
                  className="op-file-main"
                  onClick={() => onEditConflict(file.path)}
                  title={t("打开编辑器，清掉冲突标记")}
                >
                  <code className="op-code k-conflict">!</code>
                  <span className="op-path">{file.path}</span>
                </button>
                <div className="op-file-actions">
                  <button className="btn btn-xs btn-accent" disabled={busy} onClick={() => onEditConflict(file.path)}>
                    {t("编辑")}
                  </button>
                  <button
                    className="btn btn-xs"
                    disabled={busy}
                    onClick={() => run({ action: 'resolveConflict', path: file.path, side: 'ours' })}
                  >
                    {t("留本地")}
                  </button>
                  <button
                    className="btn btn-xs"
                    disabled={busy}
                    onClick={() => run({ action: 'resolveConflict', path: file.path, side: 'theirs' })}
                  >
                    {t("留对方")}
                  </button>
                </div>
              </div>
            ))}
            <div className="op-buttons">
              <button className="btn btn-sm" disabled={busy} onClick={() => run({ action: 'concludeMerge' })}>
                {t("都处理完了，完成合并")}
              </button>
              <button className="btn btn-sm btn-ghost" disabled={busy} onClick={askAbort}>
                {t("放弃这次合并")}
              </button>
            </div>
          </div>
        ) : null}

        {conflicts.length === 0 && operation === 'merge' ? (
          <div className="op-block op-block-alert">
            <div className="op-block-title">
              {t("合并进行中")}
              <span className="hint">{t("冲突都处理完了，只差最后一步提交；也可以放弃这次合并")}</span>
            </div>
            <div className="op-buttons">
              <button className="btn btn-sm btn-accent" disabled={busy} onClick={() => run({ action: 'concludeMerge' })}>
                {t("提交合并结果")}
              </button>
              <button className="btn btn-sm btn-ghost" disabled={busy} onClick={askAbort}>
                {t("放弃这次合并")}
              </button>
            </div>
          </div>
        ) : null}

        {conflicts.length === 0 && operation !== 'merge' && operation !== null ? (
          <div className="op-block">
            <div className="op-block-title">
              {operation === 'rebase' ? t("变基进行中") : operation === 'cherry-pick' ? t("拣选进行中") : t("回退进行中")}
              <span className="hint">{t("这一步还没收尾，处理完冲突后需要继续或放弃")}</span>
            </div>
            <div className="op-buttons">
              <button className="btn btn-sm btn-ghost" disabled={busy} onClick={askAbort}>
                {t("放弃这次操作")}
              </button>
            </div>
          </div>
        ) : null}

        <div className="op-tabs" role="tablist" aria-label={t("操作模块")}>
          {modules.map((module) => (
            <button
              key={module.id}
              type="button"
              role="tab"
              id={`op-tab-${module.id}`}
              aria-selected={module.id === current.id}
              aria-controls={`op-panel-${module.id}`}
              className={`op-tab${module.id === current.id ? ' is-on' : ''}`}
              onClick={() => select(module.id)}
            >
              <span className="op-tab-name">{module.title}</span>
              {module.summary ? <span className="op-tab-sum">{module.summary}</span> : null}
            </button>
          ))}
        </div>

        <div
          className="op-module"
          role="tabpanel"
          id={`op-panel-${current.id}`}
          aria-labelledby={`op-tab-${current.id}`}
          tabIndex={0}
        >
          <div className="op-module-head">
            <span className="op-module-name">{current.title}</span>
            <span className="hint">{current.hint}</span>
          </div>
          <div className="op-block-body">{body(current.id)}</div>
        </div>
      </div>
    </section>
  );
}