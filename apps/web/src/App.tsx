import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  type BranchScope,
  type CommitListItem,
  type GitActionBody,
  type GraphResponse,
  type HealthResponse,
  type RefRecord,
  type RemoteInfo,
  type RepoRecord,
  type RepoStatus,
  type RepoSummary,
  type SnapshotEntry,
  type TaskResponse,
  type TimelineResponse,
} from './api.ts';
import { AddRepoDialog } from './components/AddRepoDialog.tsx';
import { CommitList } from './components/CommitList.tsx';
import { ConfirmDialog, type ConfirmRequest } from './components/ConfirmDialog.tsx';
import { GraphView } from './components/GraphView.tsx';
import { Heatmap, HeatmapLegend } from './components/Heatmap.tsx';
import { InspectorDrawer, type InspectTarget } from './components/InspectorDrawer.tsx';
import { OperationPanel } from './components/OperationPanel.tsx';
import { RefList } from './components/RefList.tsx';
import { RepoSkeleton } from './components/RepoSkeleton.tsx';
import { SelectMenu } from './components/SelectMenu.tsx';
import { StatCard } from './components/StatCard.tsx';
import { ThemePanel } from './components/ThemePanel.tsx';
import { Toasts, type ToastItem } from './components/Toasts.tsx';
import { formatDate, formatNumber, formatRelative, webUrlOf, weeklyBuckets } from './format.ts';
import {
  applyTheme,
  loadTheme,
  saveTheme,
  watchSystemTheme,
  type ResolvedMode,
  type ThemeSettings,
} from './theme.ts';

interface RepoDetail {
  summary: RepoSummary;
  timeline: TimelineResponse;
  refs: RefRecord[];
  commits: CommitListItem[];
  graph: GraphResponse;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const HEAT_RANGES = [
  { months: 3, label: '近 3 个月' },
  { months: 6, label: '近半年' },
  { months: 12, label: '近一年' },
];

export function App({ initialTheme }: { initialTheme?: ThemeSettings } = {}) {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  // 配色：跟系统走的时候系统换主题也要跟着换
  const [theme, setTheme] = useState<ThemeSettings>(() => initialTheme ?? loadTheme());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedMode>('dark');

  useEffect(() => {
    setResolvedTheme(applyTheme(theme));
    saveTheme(theme);
  }, [theme]);

  useEffect(() => watchSystemTheme(() => setResolvedTheme(applyTheme(theme))), [theme]);

  const [repos, setRepos] = useState<RepoRecord[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<RepoDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [task, setTask] = useState<TaskResponse | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [afterTask, setAfterTask] = useState<'add' | 'reindex' | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // 写操作相关
  const [status, setStatus] = useState<RepoStatus | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([]);
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [opBusy, setOpBusy] = useState(false);
  /** 右侧检查器：工作区文件差异或某次提交的文件清单 */
  const [inspect, setInspect] = useState<InspectTarget | null>(null);
  /** 记住已经载入的仓库，用来区分"换仓库"和"同一仓库刷新" */
  const loadedRepoRef = useRef<number | null>(null);
  /** 图谱聚焦的分支；null 表示看全部 */
  const [focusRef, setFocusRef] = useState<string | null>(null);
  /** 聚焦分支能到达的提交 + 相对默认分支的领先落后 */
  const [scope, setScope] = useState<BranchScope | null>(null);

  // 轻提示与确认框
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastSeq = useRef(0);
  const toastTimers = useRef<number[]>([]);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const pushToast = useCallback(
    (text: string, tone: 'ok' | 'err' | 'info' = 'info') => {
      if (!text) return;
      toastSeq.current += 1;
      const id = toastSeq.current;
      // 最多同时留三条，旧的先走，免得盖住图谱
      setToasts((current) => [...current.slice(-2), { id, text, tone }]);
      const timer = window.setTimeout(() => dismissToast(id), tone === 'err' ? 8000 : 4500);
      toastTimers.current.push(timer);
    },
    [dismissToast],
  );

  useEffect(
    () => () => {
      for (const timer of toastTimers.current) window.clearTimeout(timer);
    },
    [],
  );

  const refreshRepos = useCallback(async () => {
    const list = await api.repos();
    setRepos(list);
    return list;
  }, []);

  // 初始加载
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [h, list] = await Promise.all([api.health(), api.repos()]);
        if (cancelled) return;
        setHealth(h);
        setRepos(list);
        setSelectedId((prev) => prev ?? list[0]?.id ?? null);
      } catch (error) {
        if (!cancelled) setGlobalError(toMessage(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 选中仓库的详情
  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      setStatus(null);
      setSnapshots([]);
      setInspect(null);
      loadedRepoRef.current = null;
      return;
    }
    // 只在真正换了仓库时清空旧数据；同一仓库刷新时保留当前画面，避免整页闪成骨架
    if (loadedRepoRef.current !== selectedId) {
      loadedRepoRef.current = selectedId;
      setInspect(null);
      setDetail(null);
      setScope(null);
      // 换仓库时回到总览，否则会拿新仓库的图去套旧分支
      setFocusRef(null);
    }
    let cancelled = false;
    setLoadingDetail(true);
    void (async () => {
      try {
        const [summary, timeline, refs, commits, graph, gitStatus, snapshotList, remoteList] = await Promise.all([
          api.summary(selectedId),
          api.timeline(selectedId),
          api.refs(selectedId),
          api.commits(selectedId, 40),
          api.graph(selectedId, 240),
          // 仓库状态读不到（目录被删、git 不可用）不该拖垮整个看板
          api.status(selectedId).catch(() => null),
          api.snapshots(selectedId).catch(() => [] as SnapshotEntry[]),
          api.remotes(selectedId).catch(() => [] as RemoteInfo[]),
        ]);
        if (cancelled) return;
        setDetail({ summary, timeline, refs, commits, graph });
        setStatus(gitStatus);
        setSnapshots(snapshotList);
        setRemotes(remoteList);
      } catch (error) {
        if (!cancelled) setGlobalError(toMessage(error));
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, reloadKey]);

  // 分支范围：决定图上谁亮谁暗，也是"选分支就跳到分支头"的依据
  const headRef = status?.branch ?? detail?.summary.defaultBranch ?? null;
  const scopeRef = focusRef ?? headRef;
  const defaultBranch = detail?.summary.defaultBranch ?? null;

  useEffect(() => {
    if (selectedId === null || !scopeRef) {
      setScope(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = await api.scope(selectedId, scopeRef, defaultBranch, 400);
        if (!cancelled) setScope(result);
      } catch {
        // 分支可能刚被删掉，静默回到总览，不打断看板
        if (!cancelled) setScope(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, scopeRef, defaultBranch]);

  // 索引任务轮询
  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const current = await api.task(taskId);
        if (cancelled) return;
        setTask(current);

        if (current.status === 'running') {
          timer = window.setTimeout(() => void poll(), 450);
          return;
        }

        setBusy(false);

        if (current.status === 'failed') {
          setTaskId(null);
          setAddError(current.error ?? '索引失败');
          return;
        }

        // 先等仓库列表和详情刷新完，再清 taskId。
        // 提前清会触发本特效的清理，把下面的刷新逻辑自己取消掉（界面停在旧状态）。
        const list = await refreshRepos();
        if (cancelled) return;

        setTaskId(null);

        if (afterTask === 'add') {
          setDialogOpen(false);
          setAddError(null);
          if (current.repoId !== null) setSelectedId(current.repoId);
          else setSelectedId((prev) => prev ?? list[0]?.id ?? null);
        } else {
          setReloadKey((key) => key + 1);
          pushToast('索引完成，图谱已经是最新的', 'ok');
        }
        setAfterTask(null);
      } catch (error) {
        if (cancelled) return;
        setBusy(false);
        setTaskId(null);
        setAddError(toMessage(error));
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [taskId, afterTask, refreshRepos, pushToast]);

  const handleAdd = async (path: string) => {
    setAddError(null);
    setTask(null);
    setBusy(true);
    setAfterTask('add');
    try {
      const result = await api.addRepo(path);
      setTaskId(result.taskId);
    } catch (error) {
      setAddError(toMessage(error));
      setBusy(false);
      setAfterTask(null);
    }
  };

  const handleReindex = async () => {
    if (selectedId === null) return;
    setGlobalError(null);
    setBusy(true);
    setTask(null);
    setAfterTask('reindex');
    try {
      const result = await api.reindex(selectedId);
      setTaskId(result.taskId);
    } catch (error) {
      setGlobalError(toMessage(error));
      setBusy(false);
      setAfterTask(null);
    }
  };

  /** 所有写操作都走这里：执行 → 提示 → 刷新（会移动 HEAD 的操作等索引跑完再刷新） */
  const handleGit = async (body: GitActionBody) => {
    if (selectedId === null || opBusy) return;
    setOpBusy(true);
    try {
      const result = await api.git(selectedId, body);
      const text = result.snapshot ? `${result.message}（已自动留回滚点）` : result.message;
      pushToast(text, result.ok ? 'ok' : 'err');

      // 切分支或建分支后，图谱直接跟过去，省得自己再滚一遍找自己的线
      if (result.ok && body.action === 'switch' && body.branch) setFocusRef(body.branch);
      if (result.ok && body.action === 'create' && body.name) setFocusRef(body.name);

      if (result.taskId) {
        setBusy(true);
        setTask(null);
        setAfterTask('reindex');
        setTaskId(result.taskId);
      } else {
        setReloadKey((key) => key + 1);
      }
    } catch (error) {
      pushToast(toMessage(error), 'err');
      setReloadKey((key) => key + 1);
    } finally {
      setOpBusy(false);
    }
  };

  const handleRemove = async () => {
    if (selectedId === null || !detail) return;
    const removedName = detail.summary.name;
    setConfirmRequest({
      title: '从列表里移除这个仓库？',
      body: `只会把「${removedName}」从 GitAtlas 的仓库列表里去掉，磁盘上的仓库和提交一条都不会动。想加回来时再选一次目录就行。`,
      confirmLabel: '移除',
      danger: true,
      onConfirm: () => {
        void (async () => {
          try {
            await api.remove(selectedId);
            const list = await refreshRepos();
            setSelectedId(list[0]?.id ?? null);
            pushToast(`已移除「${removedName}」`, 'ok');
          } catch (error) {
            pushToast(toMessage(error), 'err');
          }
        })();
      },
    });
  };

  const activeRepo = repos.find((repo) => repo.id === selectedId) ?? null;

  // 标题栏跟着当前仓库走，任务栏上也能分清窗口
  useEffect(() => {
    document.title = detail ? `${detail.summary.name} · GitAtlas` : 'GitAtlas · Git 协作图谱';
  }, [detail]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-mark" src="/logo.png" alt="" width={30} height={30} draggable={false} />
          <div className="brand-text">
            <span className="brand-name">GitAtlas</span>
            <span className="brand-sub">协作图谱</span>
          </div>
        </div>

        <button className="btn btn-primary" onClick={() => setDialogOpen(true)} disabled={busy}>
          + 添加仓库
        </button>

        <div className="sidebar-section">
          <div className="sidebar-label">
            <span>仓库</span>
            <span>{repos.length}</span>
          </div>
          {repos.map((repo) => (
            <button
              key={repo.id}
              className={`repo-item ${repo.id === selectedId ? 'active' : ''}`}
              onClick={() => setSelectedId(repo.id)}
              aria-current={repo.id === selectedId ? 'true' : undefined}
            >
              <span className="repo-item-name">{repo.name}</span>
              <span className="repo-item-meta">
                {formatNumber(repo.commitCount)} 提交 · {formatRelative(repo.lastIndexedAt)}
              </span>
            </button>
          ))}
          {repos.length === 0 ? <div className="sidebar-empty">还没有仓库</div> : null}
        </div>

        <div className="sidebar-footer">
          <ThemePanel settings={theme} resolved={resolvedTheme} onChange={setTheme} />
          <div>
            <span className={`dot ${health?.git.available ? 'ok' : 'bad'}`} />
            Git {health?.git.version ?? '未检测到'}
          </div>
          <div className="mono">{health?.url ? health.url.replace(/^https?:\/\//, '') : 'API 未连接'}</div>
        </div>
      </aside>

      <main className="main">
        {loadingDetail && detail !== null ? <div className="refresh-line" aria-hidden="true" /> : null}

        {globalError ? (
          <div className="error-banner" role="alert">
            <span>{globalError}</span>
            <button className="btn btn-xs btn-ghost" onClick={() => setGlobalError(null)}>
              知道了
            </button>
          </div>
        ) : null}

        {repos.length === 0 ? (
          <div className="empty">
            <div className="empty-badge" aria-hidden="true">
              <img src="/logo.png" alt="" width={46} height={46} draggable={false} />
            </div>
            <div className="empty-title">把仓库变成一张能看懂的图</div>
            <div className="empty-desc">
              添加一个本地 Git 仓库，GitAtlas 会解析提交历史、聚合活动节奏，并指出分支与代码里的问题。全程不用敲命令。
            </div>
            <div className="empty-actions">
              <button className="btn btn-primary" onClick={() => setDialogOpen(true)}>
                添加本地仓库
              </button>
            </div>
          </div>
        ) : detail === null ? (
          <RepoSkeleton />
        ) : (
          <RepoView
            detail={detail}
            busy={busy}
            refreshing={loadingDetail}
            onReindex={() => void handleReindex()}
            onRemove={() => void handleRemove()}
            lastIndexed={activeRepo?.lastIndexedAt ?? detail.summary.lastIndexedAt}
            status={status}
            snapshots={snapshots}
            remotes={remotes}
            opBusy={opBusy}
            onGit={(body) => void handleGit(body)}
            onConfirm={setConfirmRequest}
            onRefreshStatus={() => setReloadKey((key) => key + 1)}
            onInspect={setInspect}
            selectedSha={inspect?.kind === 'commit' ? inspect.sha : null}
            focusRef={focusRef}
            scope={scope}
            onFocus={setFocusRef}
            onToast={pushToast}
          />
        )}
      </main>

      <AddRepoDialog
        open={dialogOpen}
        busy={busy}
        task={task}
        error={addError}
        onClose={() => {
          if (!busy) {
            setDialogOpen(false);
            setAddError(null);
            setTask(null);
          }
        }}
        onSubmit={(path) => void handleAdd(path)}
      />

      <InspectorDrawer
        repoId={selectedId ?? 0}
        repoPath={detail?.summary.path ?? null}
        target={inspect}
        onClose={() => setInspect(null)}
        onGit={(body) => void handleGit(body)}
        onRefreshStatus={() => setReloadKey((key) => key + 1)}
      />

      <ConfirmDialog request={confirmRequest} onCancel={() => setConfirmRequest(null)} />
      <Toasts items={toasts} onDismiss={dismissToast} />
    </div>
  );
}

interface RepoViewProps {
  detail: RepoDetail;
  busy: boolean;
  refreshing: boolean;
  lastIndexed: string | null;
  onReindex: () => void;
  onRemove: () => void;
  status: RepoStatus | null;
  snapshots: SnapshotEntry[];
  remotes: RemoteInfo[];
  opBusy: boolean;
  onGit: (body: GitActionBody) => void;
  onConfirm: (request: ConfirmRequest) => void;
  onRefreshStatus: () => void;
  onInspect: (target: InspectTarget) => void;
  selectedSha: string | null;
  /** 当前聚焦的分支；null 表示看全部分支 */
  focusRef: string | null;
  scope: BranchScope | null;
  onFocus: (ref: string | null) => void;
  onToast: (text: string, tone?: 'ok' | 'err' | 'info') => void;
}

function RepoView({
  detail,
  busy,
  refreshing,
  lastIndexed,
  onReindex,
  onRemove,
  status,
  snapshots,
  remotes,
  opBusy,
  onGit,
  onConfirm,
  onRefreshStatus,
  onInspect,
  selectedSha,
  focusRef,
  scope,
  onFocus,
  onToast,
}: RepoViewProps) {
  const { summary, timeline, refs, commits, graph } = detail;
  const [heatMonths, setHeatMonths] = useState(12);
  const totalChanges = summary.insertions + summary.deletions;
  /** 页头显示 origin（没有就退到第一个远端），点一下直接开网页 */
  const originRemote = remotes.find((remote) => remote.name === 'origin') ?? remotes[0] ?? null;
  const originWeb = originRemote ? webUrlOf(originRemote.fetchUrl) : null;

  const firstYear = formatDate(summary.firstCommitAt).slice(0, 4);
  const lastYear = formatDate(summary.lastCommitAt).slice(0, 4);
  const yearSpan = firstYear === lastYear ? firstYear : `${firstYear}–${lastYear}`;
  const branchCount = refs.filter((ref) => ref.kind === 'branch').length;
  const tagCount = refs.filter((ref) => ref.kind === 'tag').length;

  // 索引之后又来了新提交：让"数据旧了"这件事在页头就看得见
  const stale = Boolean(
    summary.lastCommitAt && lastIndexed && new Date(summary.lastCommitAt) > new Date(lastIndexed),
  );

  const spark = useMemo(() => weeklyBuckets(timeline.days, 12), [timeline.days]);
  const heatDays = useMemo(() => {
    if (heatMonths >= 12) return timeline.days;
    return timeline.days.slice(-Math.round(heatMonths * 30.44));
  }, [timeline.days, heatMonths]);

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(summary.path);
      onToast('仓库路径已复制', 'ok');
    } catch {
      onToast('复制失败，可以手动选中路径', 'err');
    }
  };

  return (
    <>
      <header className="main-header">
        <div className="repo-title">
          <h1>
            {summary.name}
            {summary.defaultBranch ? <span className="badge badge-accent">{summary.defaultBranch}</span> : null}
            {summary.staleBranches > 0 ? (
              <span className="badge badge-warn">{summary.staleBranches} 条僵化分支</span>
            ) : null}
            {stale ? (
              <span className="badge badge-warn" title="本地 HEAD 比上次索引更新">
                有新提交未索引
              </span>
            ) : null}
          </h1>
          <div className="repo-path">
            <button className="repo-path-text mono" onClick={() => void copyPath()} title="点击复制路径">
              {summary.path}
            </button>
            {originWeb ? (
              <a className="repo-link" href={originWeb} target="_blank" rel="noreferrer" title={`在浏览器打开 ${originWeb}`}>
                {originWeb.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              </a>
            ) : (
              <span className="repo-link is-empty">未配置远端 · 在操作台里填一个地址就能拉取和推送</span>
            )}
          </div>
        </div>
        <div className="header-actions">
          <span className="badge" title={lastIndexed ? new Date(lastIndexed).toLocaleString('zh-CN') : ''}>
            索引于 {formatRelative(lastIndexed)}
          </span>
          <button className="btn" onClick={onReindex} disabled={busy}>
            {busy ? <span className="spinner" /> : '重新索引'}
          </button>
          <button className="btn btn-ghost" onClick={onRemove} disabled={busy}>
            移除
          </button>
        </div>
      </header>

      <div className={`stat-grid${refreshing ? ' is-refreshing' : ''}`}>
        <StatCard
          label="提交总数"
          value={formatNumber(summary.commitCount)}
          sub={`${formatNumber(summary.mergeCount)} 次合并`}
          spark={spark}
        />
        <StatCard
          label="贡献者"
          value={formatNumber(summary.authorCount)}
          sub={`近 30 天 ${summary.activeAuthors30d} 人`}
          tone="violet"
        />
        <StatCard
          label="分支 / 标签"
          value={`${summary.branchCount} / ${summary.tagCount}`}
          sub="含远端引用"
          tone="green"
        />
        <StatCard
          label="代码变动"
          value={`+${formatNumber(summary.insertions)}`}
          sub={`−${formatNumber(summary.deletions)} 行删除`}
          tone="amber"
          ratio={{ up: summary.insertions, down: summary.deletions }}
        />
        <StatCard
          label="历史跨度"
          value={yearSpan}
          sub={`最近提交 ${formatRelative(summary.lastCommitAt)}`}
          tone="red"
        />
        <StatCard
          label="窗口内活跃"
          value={`${timeline.totals.activeDays} 天`}
          sub={`${formatNumber(timeline.totals.commits)} 提交 / ${formatNumber(totalChanges)} 行`}
        />
      </div>

      <OperationPanel
        status={status}
        branches={refs}
        snapshots={snapshots}
        remotes={remotes}
        busy={opBusy || busy}
        onRun={onGit}
        onConfirm={onConfirm}
        onRefresh={onRefreshStatus}
        onOpenDiff={(path, staged) => onInspect({ kind: 'working', path, staged })}
        onEditConflict={(path) => onInspect({ kind: 'conflict', path })}
      />

      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="card-name">提交图谱</span>
            <span className="hint">每条泳道是一条提交链，弧线是合并；点任意一行看这次改了哪些文件</span>
          </div>
          <div className="graph-tools">
            <label className="graph-picker">
              <span>看哪条分支</span>
              <SelectMenu
                value={focusRef ?? ''}
                align="right"
                ariaLabel="看哪条分支"
                placeholder="全部分支（总览）"
                onChange={(next) => onFocus(next === '' ? null : next)}
                options={[
                  { value: '', label: '全部分支（总览）' },
                  ...refs
                    .filter((ref) => ref.kind === 'branch' || ref.kind === 'remote')
                    .slice()
                    .sort((a, b) => Number(b.isHead) - Number(a.isHead) || a.shortName.localeCompare(b.shortName))
                    .map((ref) => ({
                      value: ref.shortName,
                      label: ref.shortName,
                      ...(ref.isHead ? { hint: '当前' } : ref.kind === 'remote' ? { hint: '远端' } : {}),
                    })),
                ]}
              />
            </label>
            <div className="graph-key">
              <span className="graph-key-item">
                <i className="dot-node" /> 提交
              </span>
              <span className="graph-key-item">
                <i className="dot-merge" /> 合并
              </span>
            </div>
          </div>
        </div>
        <div className="card-body">
          <GraphView
            graph={graph}
            selectedSha={selectedSha}
            focus={scope}
            focused={focusRef}
            currentBranch={status?.branch ?? summary.defaultBranch}
            onFocus={onFocus}
            onSelect={(commit) => onInspect({ kind: 'commit', ...commit })}
          />
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="card-name">提交活动</span>
            <span className="hint">
              {timeline.from} → {timeline.to}
            </span>
          </div>
          <div className="heat-tools">
            <div className="seg" role="group" aria-label="热力图区间">
              {HEAT_RANGES.map((range) => (
                <button
                  key={range.months}
                  type="button"
                  className={heatMonths === range.months ? 'is-on' : ''}
                  aria-pressed={heatMonths === range.months}
                  onClick={() => setHeatMonths(range.months)}
                >
                  {range.label}
                </button>
              ))}
            </div>
            <HeatmapLegend />
          </div>
        </div>
        <div className="card-body">
          <Heatmap days={heatDays} />
        </div>
      </div>

      <div className="columns">
        <div className="card">
          <div className="card-head">
            <div className="card-title">
              <span className="card-name">分支与标签</span>
              <span className="hint">
                {branchCount} 分支 · {tagCount} 标签
              </span>
            </div>
          </div>
          <div className="card-body">
            <RefList refs={refs} onFocus={(ref) => onFocus(ref)} />
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title">
              <span className="card-name">最近提交</span>
              <span className="hint">按作者时间倒序，点一行看改动</span>
            </div>
          </div>
          <div className="card-body">
            <CommitList
              commits={commits}
              selectedSha={selectedSha}
              onSelect={(commit) => onInspect({ kind: 'commit', ...commit })}
            />
          </div>
        </div>
      </div>
    </>
  );
}
