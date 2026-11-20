import { translateMessage, useTranslation } from '../i18n.ts';
import { useEffect, useMemo, useState } from 'react';
import { api, type FileCommit, type FileDetail, type GitActionBody, type IgnoreFile, type TreeEntry, type TreeListing } from '../api.ts';
import { buildFileTree, collectDirPaths, type TreeNode } from '../file-tree.ts';
import type { ConfirmRequest } from './ConfirmDialog.tsx';

const PAGE_SIZE = 200;
const CHANGE_LABELS: Record<NonNullable<TreeEntry['change']>, string> = {
  added: '新增文件',
  modified: '已修改',
  deleted: '已删除',
  renamed: '已重命名',
  untracked: '未跟踪文件',
  conflict: '冲突',
};

interface WorkspacePanelProps {
  repoId: number;
  refreshKey: number;
  onOpenDiff: (path: string, staged: boolean) => void;
  onEditConflict: (path: string) => void;
  onOpenFile: (path: string) => void;
  onOpenCommit: (commit: FileCommit, path: string | null) => void;
  onGit: (body: GitActionBody) => void;
  onConfirm: (request: ConfirmRequest) => void;
  busy: boolean;
  onRefresh: () => void;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function TreeRows({
  nodes,
  depth,
  expanded,
  selected,
  onToggle,
  onSelect,
  onAction,
  busy,
}: {
  nodes: TreeNode[];
  depth: number;
  expanded: Set<string>;
  selected: string | null;
  onToggle: (path: string) => void;
  onSelect: (node: TreeNode) => void;
  onAction: (action: 'stage' | 'unstage' | 'discard', node: TreeNode) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      {nodes.map((node) => {
        const isExpandable = node.kind === 'dir' && !node.entry && node.children.length > 0;
        const isOpen = expanded.has(node.path);
        return (
          <div className="workspace-tree-item" key={`${node.path}:${node.entry?.state ?? node.kind}`}>
            <div className={`workspace-tree-row${selected === node.path ? ' is-selected' : ''}`} style={{ paddingLeft: 8 + depth * 16 }}>
              {node.kind === 'dir' ? (
                <button
                  type="button"
                  className={`workspace-caret${isOpen ? ' is-open' : ''}`}
                  aria-label={`${isOpen ? t("收起") : t("展开")} ${node.name}`}
                  aria-expanded={isExpandable ? isOpen : undefined}
                  disabled={!isExpandable}
                  onClick={() => onToggle(node.path)}
                >
                  {isExpandable ? '›' : '·'}
                </button>
              ) : (
                <span className="workspace-caret workspace-caret-empty" aria-hidden="true">·</span>
              )}
              <button type="button" className="workspace-node" onClick={() => onSelect(node)} title={node.path}>
                <span className={`workspace-node-icon is-${node.kind}${node.entry?.state === 'ignored' ? ' is-ignored' : ''}`} aria-hidden="true">
                  {node.kind === 'dir' ? '▰' : '·'}
                </span>
                <span className="workspace-node-name">{node.name}</span>
                {node.entry?.change ? <span className={`workspace-change is-${node.entry.change}`}>{t(CHANGE_LABELS[node.entry.change])}</span> : null}
                {node.entry?.state === 'ignored' ? <span className="workspace-state">{t("忽略")}</span> : null}
                {node.kind === 'dir' && !node.entry ? <span className="workspace-count">{node.changeCount ? t("{0} 改动 · ", node.changeCount) : ''}{node.fileCount}</span> : null}
                {node.kind === 'file' ? <span className="workspace-count">{formatBytes(node.entry?.size ?? null)}</span> : null}
              </button>
              {node.kind === 'file' && node.entry?.change !== 'conflict' && (node.entry?.unstaged || node.entry?.staged) ? (
                <div className="workspace-row-actions">
                  {node.entry.unstaged ? <button type="button" className="btn btn-xs btn-ghost" disabled={busy} onClick={() => onAction('stage', node)}>{t("暂存")}</button> : null}
                  {node.entry.staged ? <button type="button" className="btn btn-xs btn-ghost" disabled={busy} onClick={() => onAction('unstage', node)}>{t("取消暂存")}</button> : null}
                  {node.entry.unstaged ? <button type="button" className="btn btn-xs btn-ghost" disabled={busy} onClick={() => onAction('discard', node)}>{t("丢弃")}</button> : null}
                </div>
              ) : null}
            </div>
            {isOpen ? (
              <TreeRows
                nodes={node.children}
                depth={depth + 1}
                expanded={expanded}
                selected={selected}
                onToggle={onToggle}
                onSelect={onSelect}
                onAction={onAction}
                busy={busy}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

export function WorkspacePanel({ repoId, refreshKey, onOpenDiff, onEditConflict, onOpenFile, onOpenCommit, onGit, onConfirm, busy, onRefresh }: WorkspacePanelProps) {
  const { t } = useTranslation();
  const [listing, setListing] = useState<TreeListing | null>(null);
  const [includeIgnored, setIncludeIgnored] = useState(false);
  const [loadingTree, setLoadingTree] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsedResults, setCollapsedResults] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Pick<TreeNode, 'path' | 'kind'> | null>(null);
  const selected = selection?.path ?? null;
  const [fileDetail, setFileDetail] = useState<FileDetail | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [ignoreOpen, setIgnoreOpen] = useState(false);
  const [ignoreDirectory, setIgnoreDirectory] = useState('');
  const [ignoreFile, setIgnoreFile] = useState<IgnoreFile | null>(null);
  const [ignoreDraft, setIgnoreDraft] = useState('');
  const [ignoreLoading, setIgnoreLoading] = useState(false);
  const [ignoreBusy, setIgnoreBusy] = useState(false);
  const [ignoreError, setIgnoreError] = useState<string | null>(null);
  const [ignoreNotice, setIgnoreNotice] = useState<string | null>(null);
  const [newPattern, setNewPattern] = useState('');
  const ignoreDirty = ignoreFile !== null && ignoreDraft !== ignoreFile.text;

  useEffect(() => {
    const controller = new AbortController();
    setLoadingTree(true);
    setTreeError(null);
    const timer = window.setTimeout(() => {
      void api.tree(repoId, includeIgnored, keyword, offset, PAGE_SIZE, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        if (offset > 0 && offset >= result.total) {
          setOffset(Math.max(0, Math.ceil(result.total / PAGE_SIZE) - 1) * PAGE_SIZE);
        } else {
          setListing(result);
        }
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) setTreeError(message(error));
      }).finally(() => {
        if (!controller.signal.aborted) setLoadingTree(false);
      });
    }, keyword ? 220 : 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [repoId, includeIgnored, keyword, offset, refreshKey]);

  useEffect(() => {
    if (!selected) {
      setFileDetail(null);
      setFileError(null);
      return;
    }
    let cancelled = false;
    setFileDetail(null);
    setLoadingFile(true);
    setFileError(null);
    void api.fileDetail(repoId, selected, selection?.kind === 'dir').then((result) => {
      if (!cancelled) setFileDetail(result);
    }).catch((error: unknown) => {
      if (!cancelled) setFileError(message(error));
    }).finally(() => {
      if (!cancelled) setLoadingFile(false);
    });
    return () => {
      cancelled = true;
    };
  }, [repoId, selected, selection?.kind, refreshKey]);

  useEffect(() => {
    // 首次展开时读取；重新收起/展开不能丢掉尚未保存的编辑。
    if (!ignoreOpen || ignoreFile) return;
    let cancelled = false;
    setIgnoreLoading(true);
    setIgnoreError(null);
    void api.ignore(repoId, ignoreDirectory).then((result) => {
      if (!cancelled) {
        setIgnoreFile(result);
        setIgnoreDraft(result.text);
      }
    }).catch((error: unknown) => {
      if (!cancelled) setIgnoreError(message(error));
    }).finally(() => {
      if (!cancelled) setIgnoreLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [repoId, ignoreOpen, ignoreFile, ignoreDirectory]);

  const tree = useMemo(() => buildFileTree(listing?.entries ?? []), [listing]);
  const selectedNode = useMemo(() => {
    if (!selected) return null;
    const visit = (nodes: TreeNode[]): TreeNode | null => {
      for (const node of nodes) {
        if (node.path === selected) return node;
        const nested = visit(node.children);
        if (nested) return nested;
      }
      return null;
    };
    return visit(tree);
  }, [tree, selected]);

  const toggleDir = (path: string) => {
    const update = keyword.trim() ? setCollapsedResults : setExpanded;
    update((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const directories = collectDirPaths(tree);
  const searching = Boolean(keyword.trim());
  const visibleExpanded = searching ? new Set(directories.filter((path) => !collapsedResults.has(path))) : expanded;
  const expandAll = () => searching ? setCollapsedResults(new Set()) : setExpanded(new Set(directories));
  const collapseAll = () => searching ? setCollapsedResults(new Set(directories)) : setExpanded(new Set());

  const loadIgnoreNow = async () => {
    const result = await api.ignore(repoId, ignoreDirectory);
    setIgnoreFile(result);
    setIgnoreDraft(result.text);
  };

  const saveIgnore = async () => {
    setIgnoreBusy(true);
    setIgnoreError(null);
    setIgnoreNotice(null);
    try {
      await api.saveIgnore(repoId, ignoreDraft, ignoreDirectory);
      await loadIgnoreNow();
      onRefresh();
      setIgnoreNotice(t("已保存 .gitignore"));
    } catch (error) {
      setIgnoreError(message(error));
    } finally {
      setIgnoreBusy(false);
    }
  };

  const addPattern = async (pattern: string) => {
    if (ignoreDirty) {
      setIgnoreError(t("请先保存或撤销 .gitignore 编辑，再添加规则。"));
      return;
    }
    if (!pattern.trim()) return;
    setIgnoreBusy(true);
    setIgnoreError(null);
    setIgnoreNotice(null);
    try {
      const result = await api.addIgnore(repoId, pattern, ignoreDirectory);
      setIgnoreFile(result.file);
      setIgnoreDraft(result.file.text);
      onRefresh();
      setIgnoreNotice(result.added ? t("已添加规则：{0}", pattern) : t("这条规则已经存在"));
      setNewPattern('');
    } catch (error) {
      setIgnoreError(message(error));
    } finally {
      setIgnoreBusy(false);
    }
  };

  const removeRule = async (line: number) => {
    if (ignoreDirty) {
      setIgnoreError(t("请先保存或撤销 .gitignore 编辑，再删除规则。"));
      return;
    }
    setIgnoreBusy(true);
    setIgnoreError(null);
    try {
      const result = await api.removeIgnore(repoId, line, ignoreDirectory);
      setIgnoreFile(result);
      setIgnoreDraft(result.text);
      onRefresh();
      setIgnoreNotice(t("已移除第 {0} 行", line));
    } catch (error) {
      setIgnoreError(message(error));
    } finally {
      setIgnoreBusy(false);
    }
  };

  const directory = selection?.kind === 'dir';
  const detail = fileDetail?.path === selected && fileDetail.isDirectory === directory ? fileDetail : null;
  const containingDirectory = selected?.slice(0, Math.max(0, selected.lastIndexOf('/'))) ?? '';
  const ignoreSource = detail?.ignored ? detail.ignore?.source : null;
  const matchedIgnoreDirectory = ignoreSource === '.gitignore' ? ''
    : ignoreSource?.endsWith('/.gitignore') && !ignoreSource.startsWith('/') && !ignoreSource.includes(':')
      ? ignoreSource.slice(0, -'/.gitignore'.length) : null;

  const openIgnore = (nextDirectory: string, pattern?: string) => {
    if (ignoreDirty && ignoreDirectory !== nextDirectory) {
      setIgnoreOpen(true);
      setIgnoreError(t("请先保存或撤销 .gitignore 编辑，再切换目录。"));
      return;
    }
    if (ignoreDirectory !== nextDirectory) {
      setIgnoreFile(null);
      setIgnoreDraft('');
      setIgnoreDirectory(nextDirectory);
    }
    setIgnoreError(null);
    setIgnoreNotice(null);
    setNewPattern(pattern ?? '');
    setIgnoreOpen(true);
  };

  const runAction = (action: 'stage' | 'unstage' | 'discard', node: TreeNode) => {
    if (action !== 'discard') {
      onGit({ action, paths: [node.path] });
      return;
    }
    const untracked = node.entry?.untracked === true;
    onConfirm({
      title: t("丢弃文件改动？"),
      body: untracked ? t("将删除未跟踪文件「{0}」。", node.path) : t("将丢弃「{0}」的未暂存改动，保留暂存区版本。", node.path),
      confirmLabel: t("丢弃"),
      danger: true,
      onConfirm: () => onGit({ action, paths: [node.path], untracked }),
    });
  };

  return (
    <section className="card workspace-card" aria-label={t("工作目录")}>
      <div className="card-head">
        <div className="card-title">
          <span className="card-name">{t("工作目录")}</span>
          <span className="hint">{t("浏览已跟踪、未跟踪文件；选中文件查看详情与提交历史")}</span>
        </div>
        <div className="workspace-tools">
          <label className="workspace-ignored-toggle">
            <input type="checkbox" checked={includeIgnored} onChange={(event) => { setIncludeIgnored(event.target.checked); setOffset(0); setListing(null); }} />
            {t("显示忽略项")}
          </label>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onRefresh} disabled={loadingTree}>
            {loadingTree ? t("刷新中…") : t("刷新")}
          </button>
        </div>
      </div>
      {treeError ? <div className="workspace-error" role="alert">{translateMessage(treeError)}</div> : null}
      <div className="workspace-layout">
        <div className="workspace-browser">
          <div className="workspace-summary">
            <span>{listing ? t("{0} 跟踪 · {1} 未跟踪 · {2} 改动", listing.counts.tracked.toLocaleString(), listing.counts.untracked.toLocaleString(), listing.counts.changed.toLocaleString()) : t("载入工作目录…")}</span>
            <div className="workspace-tree-tools">
              <button type="button" onClick={expandAll} disabled={!directories.length}>{t("全部展开")}</button>
              <button type="button" onClick={collapseAll} disabled={!visibleExpanded.size}>{t("全部收起")}</button>
            </div>
          </div>
          <input
            className="workspace-search"
            type="search"
            value={keyword}
            onChange={(event) => { setKeyword(event.target.value); setOffset(0); setListing(null); setCollapsedResults(new Set()); }}
            placeholder={t("筛选文件名或路径…")}
            aria-label={t("筛选工作目录文件")}
          />
          <div key={listing?.offset ?? 0} className="workspace-tree" role="tree" aria-label={t("仓库文件树")} aria-busy={loadingTree}>
            {loadingTree && !listing ? <div className="workspace-empty">{t("正在读取文件列表…")}</div> : null}
            {!loadingTree && !treeError && tree.length === 0 ? <div className="workspace-empty">{keyword ? t("没有匹配的文件") : t("工作目录为空")}</div> : null}
            <TreeRows
              nodes={tree}
              depth={0}
              expanded={visibleExpanded}
              selected={selected}
              onToggle={toggleDir}
              onSelect={({ path, kind }) => setSelection({ path, kind })}
              onAction={runAction}
              busy={busy || loadingTree}
            />
          </div>
          {listing && listing.total > PAGE_SIZE ? (
            <nav className="workspace-pagination" aria-label={t("文件列表分页")}>
              <button type="button" className="btn btn-xs btn-ghost" disabled={!offset || loadingTree} onClick={() => setOffset(offset - PAGE_SIZE)}>{t("上一页")}</button>
              <span>{`${listing.offset + 1}–${listing.offset + listing.entries.length} / ${listing.total.toLocaleString()}`}</span>
              <button type="button" className="btn btn-xs btn-ghost" disabled={listing.nextOffset === null || loadingTree} onClick={() => setOffset(listing.nextOffset ?? offset)}>{t("下一页")}</button>
            </nav>
          ) : null}
        </div>

        <div className="workspace-detail" aria-live="polite">
          {selected ? (
            <>
              <div className="workspace-detail-head">
                <div className="workspace-detail-title" title={selected}>{selected}</div>
                <div className="workspace-detail-actions">
                  {selectedNode?.kind === 'file' && selectedNode.entry?.change === 'conflict' ? (
                    <button type="button" className="btn btn-xs btn-danger" onClick={() => onEditConflict(selected)}>{t("解决冲突")}</button>
                  ) : null}
                  {detail?.exists && !directory && selectedNode?.entry?.change !== 'conflict' ? (
                    <button type="button" className="btn btn-xs" onClick={() => onOpenFile(selected)}>{t("打开文件")}</button>
                  ) : null}
                  {selectedNode?.kind === 'file' && selectedNode.entry?.staged ? (
                    <button type="button" className="btn btn-xs btn-ghost" onClick={() => onOpenDiff(selected, true)}>{t("看暂存差异")}</button>
                  ) : null}
                  {selectedNode?.kind === 'file' && selectedNode.entry?.unstaged ? (
                    <button type="button" className="btn btn-xs" onClick={() => onOpenDiff(selected, false)}>{t("看工作区差异")}</button>
                  ) : null}
                  {detail?.exists ? <button type="button" className="btn btn-xs btn-ghost" disabled={ignoreBusy} onClick={() => {
                    const literal = selected.slice(containingDirectory ? containingDirectory.length + 1 : 0).replace(/([\\*?\[\] ])/g, '\\$1');
                    openIgnore(containingDirectory, `/${literal}${directory ? '/' : ''}`);
                  }}>{t("加入忽略")}</button> : null}
                  {directory && detail?.exists && !detail.ignored ? <button type="button" className="btn btn-xs btn-ghost" disabled={ignoreBusy} onClick={() => openIgnore(selected)}>{t("管理此目录的 .gitignore")}</button> : null}
                </div>
              </div>
              {loadingFile ? <div className="workspace-empty">{t("正在读取文件详情…")}</div> : null}
              {fileError ? <div className="workspace-error" role="alert">{translateMessage(fileError)}</div> : null}
              {detail ? (
                <>
                  <div className="workspace-facts">
                    <div><span>{t("状态")}</span><b>{detail.ignored ? t("已忽略") : directory ? t("目录") : detail.tracked ? t("已跟踪") : detail.exists ? t("未跟踪") : t("历史文件")}</b></div>
                    {directory ? <div><span>{t("类型")}</span><b>{t("目录")}</b></div> : <>
                      <div><span>{t("大小")}</span><b>{formatBytes(detail.size)}</b></div>
                      <div><span>{t("行数")}</span><b>{detail.lines === null ? '—' : detail.lines.toLocaleString()}</b></div>
                    </>}
                    <div><span>{t("提交次数")}</span><b>{detail.commitCount?.toLocaleString() ?? '—'}</b></div>
                    <div><span>{t("近 30 天")}</span><b>{detail.commits30d ?? '—'}</b></div>
                    <div><span>{t("近期增删")}</span><b>+{detail.churn.insertions.toLocaleString()} / −{detail.churn.deletions.toLocaleString()}</b></div>
                  </div>
                  {detail.ignore ? <div className="workspace-note">{t("忽略规则：")}<code>{detail.ignore.source}:{detail.ignore.line}</code> · <code>{detail.ignore.pattern}</code> {matchedIgnoreDirectory !== null ? <button type="button" className="btn btn-xs btn-ghost" disabled={ignoreBusy} onClick={() => openIgnore(matchedIgnoreDirectory)}>{t("编辑规则文件")}</button> : null}</div> : null}
                  {detail.note ? <div className="workspace-note">{translateMessage(detail.note)}</div> : null}
                  <div className="workspace-history-head">{t("最近修改")}</div>
                  {detail.history.length ? (
                    <ul className="workspace-history">
                      {detail.history.map((commit) => (
                        <li key={commit.sha}>
                          <button type="button" className="workspace-history-link" onClick={() => onOpenCommit(commit, directory ? null : commit.path ?? selected)} title={commit.subject}>
                            <code>{commit.shortSha}</code>
                            <span className="workspace-history-subject">{commit.subject}</span>
                            <span>{commit.authorName}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : <div className="workspace-empty">{t("暂无提交历史")}</div>}
                </>
              ) : null}
            </>
          ) : (
            <div className="workspace-empty workspace-detail-placeholder">{t("选择左侧文件或目录，查看大小、改动与历史。")}</div>
          )}
        </div>
      </div>

      <div className={`workspace-ignore${ignoreOpen ? ' is-open' : ''}`}>
        <div className="workspace-ignore-head">
          <div>
            <b>{ignoreDirectory ? `${ignoreDirectory}/.gitignore` : '.gitignore'}</b>
            <span>{ignoreFile?.exists ? t("{0} 条规则", ignoreFile.activeCount) : t("尚未创建")}</span>
          </div>
          {ignoreDirectory ? <button type="button" className="btn btn-sm btn-ghost" disabled={ignoreBusy} onClick={() => openIgnore('')}>{t("根目录 .gitignore")}</button> : null}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setIgnoreOpen((open) => !open)} aria-expanded={ignoreOpen}>
            {ignoreOpen ? t("收起编辑器") : t("管理忽略规则")}
          </button>
        </div>
        {ignoreOpen ? (
          <div className="workspace-ignore-editor">
            <div className="workspace-ignore-add">
              <input className="op-input" value={newPattern} onChange={(event) => setNewPattern(event.target.value)} placeholder={t("新增规则，例如 dist/ 或 *.log")} disabled={ignoreBusy} />
              <button type="button" className="btn btn-sm" disabled={ignoreBusy || ignoreLoading || !ignoreFile || ignoreDirty || !newPattern.trim()} onClick={() => void addPattern(newPattern)}>{t("添加规则")}</button>
            </div>
            <label className="workspace-editor-label" htmlFor="gitignore-editor">{t("规则文件（每行一条，# 开头为注释）")}</label>
            <textarea id="gitignore-editor" className="workspace-ignore-text" value={ignoreDraft} onChange={(event) => setIgnoreDraft(event.target.value)} spellCheck={false} disabled={ignoreLoading || ignoreBusy || !ignoreFile} />
            <div className="workspace-ignore-actions">
              <span className="workspace-message" role={ignoreError ? 'alert' : 'status'}>{ignoreError ? translateMessage(ignoreError) : ignoreNotice ?? (ignoreLoading ? t("正在读取 .gitignore…") : '')}</span>
              {ignoreDirty ? <button type="button" className="btn btn-sm btn-ghost" disabled={ignoreBusy} onClick={() => { setIgnoreDraft(ignoreFile.text); setIgnoreError(null); }}>{t("撤销编辑")}</button> : null}
              <button type="button" className="btn btn-sm btn-primary" disabled={ignoreBusy || ignoreLoading || !ignoreDirty} onClick={() => void saveIgnore()}>{ignoreBusy ? t("保存中…") : t("保存文件")}</button>
            </div>
            {ignoreFile?.rules.length ? (
              <div className="workspace-rule-list" aria-label={t("逐条删除忽略规则")}>
                {ignoreFile.rules.map((rule) => (
                  <div className={`workspace-rule${rule.comment || rule.blank ? ' is-muted' : ''}`} key={rule.line}>
                    <code>{rule.line}</code><span>{rule.raw || t("（空行）")}</span>
                    <button type="button" className="btn btn-xs btn-ghost" disabled={ignoreBusy || ignoreDirty} onClick={() => void removeRule(rule.line)}>{t("删除此行")}</button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
