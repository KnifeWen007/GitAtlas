import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type CommitListItem,
  type GraphResponse,
  type HealthResponse,
  type RefRecord,
  type RepoRecord,
  type RepoSummary,
  type TaskResponse,
  type TimelineResponse,
} from './api.ts';
import { AddRepoDialog } from './components/AddRepoDialog.tsx';
import { CommitList } from './components/CommitList.tsx';
import { GraphView } from './components/GraphView.tsx';
import { Heatmap, HeatmapLegend } from './components/Heatmap.tsx';
import { RefList } from './components/RefList.tsx';
import { StatCard } from './components/StatCard.tsx';
import { formatDate, formatNumber, formatRelative } from './format.ts';

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

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
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
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    void (async () => {
      try {
        const [summary, timeline, refs, commits, graph] = await Promise.all([
          api.summary(selectedId),
          api.timeline(selectedId),
          api.refs(selectedId),
          api.commits(selectedId, 40),
          api.graph(selectedId, 240),
        ]);
        if (cancelled) return;
        setDetail({ summary, timeline, refs, commits, graph });
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
        setTaskId(null);

        if (current.status === 'failed') {
          setAddError(current.error ?? '索引失败');
          return;
        }

        const list = await refreshRepos();
        if (cancelled) return;

        if (afterTask === 'add') {
          setDialogOpen(false);
          setAddError(null);
          if (current.repoId !== null) setSelectedId(current.repoId);
          else setSelectedId((prev) => prev ?? list[0]?.id ?? null);
        } else {
          setReloadKey((key) => key + 1);
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
  }, [taskId, afterTask, refreshRepos]);

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

  const handleRemove = async () => {
    if (selectedId === null || !detail) return;
    const confirmed = window.confirm(`从 GitAtlas 移除「${detail.summary.name}」？（不影响仓库本身）`);
    if (!confirmed) return;
    try {
      await api.remove(selectedId);
      const list = await refreshRepos();
      setSelectedId(list[0]?.id ?? null);
    } catch (error) {
      setGlobalError(toMessage(error));
    }
  };

  const activeRepo = repos.find((repo) => repo.id === selectedId) ?? null;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" />
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
            >
              <span className="repo-item-name">{repo.name}</span>
              <span className="repo-item-meta">
                {formatNumber(repo.commitCount)} 提交 · {formatRelative(repo.lastIndexedAt)}
              </span>
            </button>
          ))}
          {repos.length === 0 ? (
            <div className="sidebar-label" style={{ padding: '8px 8px 0' }}>
              还没有仓库
            </div>
          ) : null}
        </div>

        <div className="sidebar-footer">
          <div>
            <span className={`dot ${health?.git.available ? 'ok' : 'bad'}`} />
            Git {health?.git.version ?? '未检测到'}
          </div>
          <div className="mono">{health?.url ? health.url.replace(/^https?:\/\//, '') : 'API 未连接'}</div>
        </div>
      </aside>

      <main className="main">
        {globalError ? (
          <div className="card" style={{ padding: '10px 16px', marginBottom: 14, borderColor: 'rgba(248,113,113,0.4)' }}>
            <span className="error-text">{globalError}</span>
          </div>
        ) : null}

        {repos.length === 0 ? (
          <div className="empty">
            <div className="empty-title">把仓库变成一张能看懂的图</div>
            <div className="empty-desc">
              添加一个本地 Git 仓库，GitAtlas 会解析提交历史、聚合活动节奏，并指出分支与代码里的问题。
            </div>
            <div className="empty-actions">
              <button className="btn btn-primary" onClick={() => setDialogOpen(true)}>
                添加本地仓库
              </button>
            </div>
          </div>
        ) : detail === null || loadingDetail ? (
          <div className="empty">
            <div className="spinner" />
            <div className="empty-desc">正在加载仓库数据…</div>
          </div>
        ) : (
          <RepoView
            detail={detail}
            busy={busy}
            onReindex={() => void handleReindex()}
            onRemove={() => void handleRemove()}
            lastIndexed={activeRepo?.lastIndexedAt ?? detail.summary.lastIndexedAt}
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
    </div>
  );
}

interface RepoViewProps {
  detail: RepoDetail;
  busy: boolean;
  lastIndexed: string | null;
  onReindex: () => void;
  onRemove: () => void;
}

function RepoView({ detail, busy, lastIndexed, onReindex, onRemove }: RepoViewProps) {
  const { summary, timeline, refs, commits, graph } = detail;
  const totalChanges = summary.insertions + summary.deletions;

  const firstYear = formatDate(summary.firstCommitAt).slice(0, 4);
  const lastYear = formatDate(summary.lastCommitAt).slice(0, 4);
  const yearSpan = firstYear === lastYear ? firstYear : `${firstYear}–${lastYear}`;
  const branchCount = refs.filter((ref) => ref.kind === 'branch').length;
  const tagCount = refs.filter((ref) => ref.kind === 'tag').length;

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
          </h1>
          <div className="repo-path">{summary.path}</div>
        </div>
        <div className="header-actions">
          <span className="badge">索引于 {formatRelative(lastIndexed)}</span>
          <button className="btn" onClick={onReindex} disabled={busy}>
            {busy ? <span className="spinner" /> : '重新索引'}
          </button>
          <button className="btn btn-ghost" onClick={onRemove} disabled={busy}>
            移除
          </button>
        </div>
      </header>

      <div className="stat-grid">
        <StatCard
          label="提交总数"
          value={formatNumber(summary.commitCount)}
          sub={`${formatNumber(summary.mergeCount)} 次合并`}
        />
        <StatCard
          label="贡献者"
          value={formatNumber(summary.authorCount)}
          sub={`近 30 天 ${summary.activeAuthors30d} 人`}
          tone="violet"
        />
        <StatCard label="分支 / 标签" value={`${summary.branchCount} / ${summary.tagCount}`} sub="含远端引用" tone="green" />
        <StatCard
          label="代码变动"
          value={`+${formatNumber(summary.insertions)}`}
          sub={`−${formatNumber(summary.deletions)} 行删除`}
          tone="amber"
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

      <div className="card">
        <div className="card-head">
          <div className="card-title">
            提交图谱
            <span className="hint">每条泳道是一条提交链，弧线是合并</span>
          </div>
          <div className="graph-key">
            <span className="graph-key-item">
              <i className="dot-node" /> 提交
            </span>
            <span className="graph-key-item">
              <i className="dot-merge" /> 合并
            </span>
          </div>
        </div>
        <div className="card-body">
          <GraphView graph={graph} />
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">
            提交活动
            <span className="hint">
              {timeline.from} → {timeline.to}
            </span>
          </div>
          <HeatmapLegend />
        </div>
        <div className="card-body">
          <Heatmap days={timeline.days} />
        </div>
      </div>

      <div className="columns">
        <div className="card">
          <div className="card-head">
            <div className="card-title">
              分支与标签
              <span className="hint">
                {branchCount} 分支 · {tagCount} 标签
              </span>
            </div>
          </div>
          <div className="card-body">
            <RefList refs={refs} />
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title">
              最近提交
              <span className="hint">按作者时间倒序</span>
            </div>
          </div>
          <div className="card-body">
            <CommitList commits={commits} />
          </div>
        </div>
      </div>
    </>
  );
}
