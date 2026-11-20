import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type FileDetail, type IgnoreFile, type TreeListing } from '../api.ts';
import { buildFileTree, collectDirPaths, filterFileTree, type TreeNode } from '../file-tree.ts';

interface WorkspacePanelProps {
  repoId: number;
  refreshKey: number;
  onOpenDiff: (path: string, staged: boolean) => void;
  onEditConflict: (path: string) => void;
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
}: {
  nodes: TreeNode[];
  depth: number;
  expanded: Set<string>;
  selected: string | null;
  onToggle: (path: string) => void;
  onSelect: (node: TreeNode) => void;
}) {
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
                  aria-label={`${isOpen ? '收起' : '展开'} ${node.name}`}
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
                {node.entry?.change ? <span className={`workspace-change is-${node.entry.change}`}>{node.entry.change}</span> : null}
                {node.entry?.state === 'ignored' ? <span className="workspace-state">忽略</span> : null}
                {node.kind === 'dir' && !node.entry ? <span className="workspace-count">{node.changeCount ? `${node.changeCount} 改动 · ` : ''}{node.fileCount}</span> : null}
                {node.kind === 'file' ? <span className="workspace-count">{formatBytes(node.entry?.size ?? null)}</span> : null}
              </button>
            </div>
            {isOpen ? (
              <TreeRows
                nodes={node.children}
                depth={depth + 1}
                expanded={expanded}
                selected={selected}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

export function WorkspacePanel({ repoId, refreshKey, onOpenDiff, onEditConflict, onRefresh }: WorkspacePanelProps) {
  const [listing, setListing] = useState<TreeListing | null>(null);
  const [includeIgnored, setIncludeIgnored] = useState(false);
  const [loadingTree, setLoadingTree] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [fileDetail, setFileDetail] = useState<FileDetail | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [ignoreOpen, setIgnoreOpen] = useState(false);
  const [ignoreFile, setIgnoreFile] = useState<IgnoreFile | null>(null);
  const [ignoreDraft, setIgnoreDraft] = useState('');
  const [ignoreLoading, setIgnoreLoading] = useState(false);
  const [ignoreBusy, setIgnoreBusy] = useState(false);
  const [ignoreError, setIgnoreError] = useState<string | null>(null);
  const [ignoreNotice, setIgnoreNotice] = useState<string | null>(null);
  const [newPattern, setNewPattern] = useState('');
  const ignoreDirty = ignoreFile !== null && ignoreDraft !== ignoreFile.text;

  const loadTree = useCallback(async () => {
    setLoadingTree(true);
    setTreeError(null);
    try {
      setListing(await api.tree(repoId, includeIgnored));
    } catch (error) {
      setTreeError(message(error));
    } finally {
      setLoadingTree(false);
    }
  }, [repoId, includeIgnored]);

  useEffect(() => {
    void loadTree();
  }, [loadTree, refreshKey]);

  useEffect(() => {
    if (!selected) {
      setFileDetail(null);
      setFileError(null);
      return;
    }
    let cancelled = false;
    setLoadingFile(true);
    setFileError(null);
    void api.fileDetail(repoId, selected).then((result) => {
      if (!cancelled) setFileDetail(result);
    }).catch((error: unknown) => {
      if (!cancelled) setFileError(message(error));
    }).finally(() => {
      if (!cancelled) setLoadingFile(false);
    });
    return () => {
      cancelled = true;
    };
  }, [repoId, selected, refreshKey]);

  useEffect(() => {
    setIgnoreFile(null);
    setIgnoreDraft('');
    setSelected(null);
    setFileDetail(null);
  }, [repoId]);

  useEffect(() => {
    // 首次展开时读取；重新收起/展开不能丢掉尚未保存的编辑。
    if (!ignoreOpen || ignoreFile) return;
    let cancelled = false;
    setIgnoreLoading(true);
    setIgnoreError(null);
    void api.ignore(repoId).then((result) => {
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
  }, [repoId, ignoreOpen, ignoreFile]);

  const tree = useMemo(() => buildFileTree(listing?.entries ?? []), [listing]);
  const visibleTree = useMemo(() => filterFileTree(tree, keyword), [tree, keyword]);
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
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(collectDirPaths(tree)));
  const collapseAll = () => setExpanded(new Set());

  const loadIgnoreNow = async () => {
    const result = await api.ignore(repoId);
    setIgnoreFile(result);
    setIgnoreDraft(result.text);
  };

  const saveIgnore = async () => {
    setIgnoreBusy(true);
    setIgnoreError(null);
    setIgnoreNotice(null);
    try {
      await api.saveIgnore(repoId, ignoreDraft);
      await loadIgnoreNow();
      await loadTree();
      onRefresh();
      setIgnoreNotice('已保存 .gitignore');
    } catch (error) {
      setIgnoreError(message(error));
    } finally {
      setIgnoreBusy(false);
    }
  };

  const addPattern = async (pattern: string) => {
    if (ignoreDirty) {
      setIgnoreError('请先保存或撤销 .gitignore 编辑，再添加规则。');
      return;
    }
    const trimmed = pattern.trim();
    if (!trimmed) return;
    setIgnoreBusy(true);
    setIgnoreError(null);
    setIgnoreNotice(null);
    try {
      const result = await api.addIgnore(repoId, trimmed);
      setIgnoreFile(result.file);
      setIgnoreDraft(result.file.text);
      await loadTree();
      onRefresh();
      setIgnoreNotice(result.added ? `已添加规则：${trimmed}` : '这条规则已经存在');
      setNewPattern('');
    } catch (error) {
      setIgnoreError(message(error));
    } finally {
      setIgnoreBusy(false);
    }
  };

  const removeRule = async (line: number) => {
    if (ignoreDirty) {
      setIgnoreError('请先保存或撤销 .gitignore 编辑，再删除规则。');
      return;
    }
    setIgnoreBusy(true);
    setIgnoreError(null);
    try {
      const result = await api.removeIgnore(repoId, line);
      setIgnoreFile(result);
      setIgnoreDraft(result.text);
      await loadTree();
      onRefresh();
      setIgnoreNotice(`已移除第 ${line} 行`);
    } catch (error) {
      setIgnoreError(message(error));
    } finally {
      setIgnoreBusy(false);
    }
  };

  const title = selectedNode?.path ?? selected ?? '';
  const quickIgnore = selectedNode?.kind === 'dir' ? `${selectedNode.path}/` : selectedNode?.path ?? '';

  return (
    <section className="card workspace-card" aria-label="工作目录">
      <div className="card-head">
        <div className="card-title">
          <span className="card-name">工作目录</span>
          <span className="hint">浏览已跟踪、未跟踪文件；选中文件查看详情与提交历史</span>
        </div>
        <div className="workspace-tools">
          <label className="workspace-ignored-toggle">
            <input type="checkbox" checked={includeIgnored} onChange={(event) => setIncludeIgnored(event.target.checked)} />
            显示忽略项
          </label>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void loadTree()} disabled={loadingTree}>
            {loadingTree ? '刷新中…' : '刷新'}
          </button>
        </div>
      </div>
      {treeError ? <div className="workspace-error" role="alert">{treeError}</div> : null}
      <div className="workspace-layout">
        <div className="workspace-browser">
          <div className="workspace-summary">
            <span>{listing ? `${listing.counts.tracked.toLocaleString()} 跟踪 · ${listing.counts.untracked.toLocaleString()} 未跟踪 · ${listing.counts.changed.toLocaleString()} 改动` : '载入工作目录…'}</span>
            <div className="workspace-tree-tools">
              <button type="button" onClick={expandAll} disabled={!tree.length}>全部展开</button>
              <button type="button" onClick={collapseAll} disabled={!expanded.size}>全部收起</button>
            </div>
          </div>
          <input
            className="workspace-search"
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="筛选文件名或路径…"
            aria-label="筛选工作目录文件"
          />
          <div className="workspace-tree" role="tree" aria-label="仓库文件树" aria-busy={loadingTree}>
            {loadingTree && !listing ? <div className="workspace-empty">正在读取文件列表…</div> : null}
            {!loadingTree && !treeError && visibleTree.length === 0 ? <div className="workspace-empty">{keyword ? '没有匹配的文件' : '工作目录为空'}</div> : null}
            {listing?.truncated ? <div className="workspace-note">仓库共有 {listing.total.toLocaleString()} 项；为保证响应速度，仅显示前 {listing.entries.length.toLocaleString()} 项。</div> : null}
            <TreeRows
              nodes={visibleTree}
              depth={0}
              expanded={keyword.trim() ? new Set(collectDirPaths(visibleTree)) : expanded}
              selected={selected}
              onToggle={toggleDir}
              onSelect={(node) => setSelected(node.path)}
            />
          </div>
        </div>

        <div className="workspace-detail" aria-live="polite">
          {selected ? (
            <>
              <div className="workspace-detail-head">
                <div className="workspace-detail-title" title={title}>{title}</div>
                <div className="workspace-detail-actions">
                  {selectedNode?.kind === 'file' && selectedNode.entry?.change === 'conflict' ? (
                    <button type="button" className="btn btn-xs btn-danger" onClick={() => onEditConflict(selected)}>解决冲突</button>
                  ) : null}
                  {selectedNode?.kind === 'file' && selectedNode.entry?.staged ? (
                    <button type="button" className="btn btn-xs btn-ghost" onClick={() => onOpenDiff(selected, true)}>看暂存差异</button>
                  ) : null}
                  {selectedNode?.kind === 'file' && selectedNode.entry?.unstaged ? (
                    <button type="button" className="btn btn-xs" onClick={() => onOpenDiff(selected, false)}>看工作区差异</button>
                  ) : null}
                  {quickIgnore ? <button type="button" className="btn btn-xs btn-ghost" onClick={() => { setIgnoreOpen(true); setNewPattern(quickIgnore); }}>加入忽略</button> : null}
                </div>
              </div>
              {loadingFile ? <div className="workspace-empty">正在读取文件详情…</div> : null}
              {fileError ? <div className="workspace-error" role="alert">{fileError}</div> : null}
              {fileDetail ? (
                <>
                  <div className="workspace-facts">
                    <div><span>状态</span><b>{fileDetail.isDirectory ? '目录' : fileDetail.tracked ? '已跟踪' : fileDetail.ignored ? '已忽略' : fileDetail.exists ? '未跟踪' : '历史文件'}</b></div>
                    <div><span>大小</span><b>{formatBytes(fileDetail.size)}</b></div>
                    <div><span>行数</span><b>{fileDetail.lines === null ? '—' : fileDetail.lines.toLocaleString()}</b></div>
                    <div><span>提交次数</span><b>{fileDetail.commitCount === null ? '—' : fileDetail.commitCount.toLocaleString()}</b></div>
                    <div><span>近 30 天</span><b>{fileDetail.commits30d === null ? '—' : fileDetail.commits30d}</b></div>
                    <div><span>累计变更</span><b>+{fileDetail.churn.insertions.toLocaleString()} / −{fileDetail.churn.deletions.toLocaleString()}</b></div>
                  </div>
                  {fileDetail.ignore ? <div className="workspace-note">忽略规则：<code>{fileDetail.ignore.source}:{fileDetail.ignore.line}</code> · <code>{fileDetail.ignore.pattern}</code></div> : null}
                  {fileDetail.note ? <div className="workspace-note">{fileDetail.note}</div> : null}
                  <div className="workspace-history-head">最近修改</div>
                  {fileDetail.history.length ? (
                    <ul className="workspace-history">
                      {fileDetail.history.slice(0, 6).map((commit) => (
                        <li key={commit.sha}>
                          <code>{commit.shortSha}</code>
                          <span className="workspace-history-subject" title={commit.subject}>{commit.subject}</span>
                          <span>{commit.authorName}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <div className="workspace-empty">暂无提交历史</div>}
                </>
              ) : null}
            </>
          ) : (
            <div className="workspace-empty workspace-detail-placeholder">选择左侧文件或目录，查看大小、改动与历史。</div>
          )}
        </div>
      </div>

      <div className={`workspace-ignore${ignoreOpen ? ' is-open' : ''}`}>
        <div className="workspace-ignore-head">
          <div>
            <b>.gitignore</b>
            <span>{ignoreFile?.exists ? `${ignoreFile.activeCount} 条规则` : '尚未创建'}</span>
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setIgnoreOpen((open) => !open)} aria-expanded={ignoreOpen}>
            {ignoreOpen ? '收起编辑器' : '管理忽略规则'}
          </button>
        </div>
        {ignoreOpen ? (
          <div className="workspace-ignore-editor">
            <div className="workspace-ignore-add">
              <input className="op-input" value={newPattern} onChange={(event) => setNewPattern(event.target.value)} placeholder="新增规则，例如 dist/ 或 *.log" disabled={ignoreBusy} />
              <button type="button" className="btn btn-sm" disabled={ignoreBusy || ignoreDirty || !newPattern.trim()} onClick={() => void addPattern(newPattern)}>添加规则</button>
            </div>
            <label className="workspace-editor-label" htmlFor="gitignore-editor">规则文件（每行一条，# 开头为注释）</label>
            <textarea id="gitignore-editor" className="workspace-ignore-text" value={ignoreDraft} onChange={(event) => setIgnoreDraft(event.target.value)} spellCheck={false} disabled={ignoreLoading || ignoreBusy} />
            <div className="workspace-ignore-actions">
              <span className="workspace-message" role={ignoreError ? 'alert' : 'status'}>{ignoreError ?? ignoreNotice ?? (ignoreLoading ? '正在读取 .gitignore…' : '')}</span>
              <button type="button" className="btn btn-sm btn-primary" disabled={ignoreBusy || ignoreLoading} onClick={() => void saveIgnore()}>{ignoreBusy ? '保存中…' : '保存文件'}</button>
            </div>
            {ignoreFile?.rules.length ? (
              <div className="workspace-rule-list" aria-label="逐条删除忽略规则">
                {ignoreFile.rules.map((rule) => (
                  <div className={`workspace-rule${rule.comment || rule.blank ? ' is-muted' : ''}`} key={rule.line}>
                    <code>{rule.line}</code><span>{rule.raw || '（空行）'}</span>
                    <button type="button" className="btn btn-xs btn-ghost" disabled={ignoreBusy || ignoreDirty} onClick={() => void removeRule(rule.line)}>删除此行</button>
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
