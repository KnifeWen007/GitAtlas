import { translateMessage, useTranslation } from '../i18n.ts';
import { useEffect, useState } from 'react';
import { api, type CommitFile, type FileDiff, type GitActionBody, type WorkingFileContent } from '../api.ts';
import { formatDate } from '../format.ts';
import { DiffBody } from './DiffBody.tsx';
import type { ConfirmRequest } from './ConfirmDialog.tsx';

export type InspectTarget =
  | { kind: 'working'; path: string; staged: boolean }
  | { kind: 'commit'; sha: string; subject: string; authorName: string; authoredAt: string; path?: string | null }
  | { kind: 'file'; path: string }
  | { kind: 'conflict'; path: string };

interface InspectorDrawerProps {
  repoId: number;
  /** 仓库绝对路径，用来拼出"用默认程序打开"的目标 */
  repoPath: string | null;
  target: InspectTarget | null;
  onClose: () => void;
  onConfirm: (request: ConfirmRequest) => void;
  onGit: (body: GitActionBody) => void;
  onRefreshStatus: () => void;
}

const STATUS_TEXT: Record<CommitFile['status'], string> = {
  added: '新增',
  deleted: '删除',
  renamed: '改名',
  copied: '复制',
  binary: '二进制',
  modified: '修改',
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function absolutePath(repoPath: string | null, filePath: string): string | null {
  if (!repoPath) return null;
  const base = repoPath.replace(/\\/g, '/').replace(/\/+$/, '');
  return `${base}/${filePath}`;
}

/**
 * 右侧检查器：看差异、看提交改了哪些文件，冲突时还能直接在这里改。
 * 两种查看入口共用一个抽屉，避免屏幕上出现两套"看改动"的地方。
 */
export function InspectorDrawer({ repoId, repoPath, target, onClose, onConfirm, onGit, onRefreshStatus }: InspectorDrawerProps) {
  const { t } = useTranslation();
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [files, setFiles] = useState<CommitFile[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 冲突编辑器
  const [file, setFile] = useState<WorkingFileContent | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [jumpError, setJumpError] = useState<string | null>(null);

  const commitSha = target?.kind === 'commit' ? target.sha : null;
  const commitPath = target?.kind === 'commit' ? target.path : null;
  const conflict = target?.kind === 'conflict';
  const editorPath = target?.kind === 'file' || conflict ? target.path : null;
  const dirty = file !== null && draft !== file.text;

  const desktop = Boolean(window.gitatlas?.desktop);

  const close = () => {
    if (saving) return;
    if (dirty) {
      onConfirm({ title: t("放弃未保存的编辑？"), body: t("关闭编辑器将丢弃未保存的内容。"), confirmLabel: t("放弃编辑"), danger: true, onConfirm: onClose });
    } else {
      onClose();
    }
  };

  useEffect(() => {
    if (!target) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // 打开某次提交：先取文件清单，默认选中第一个
  useEffect(() => {
    if (!commitSha) {
      setFiles(null);
      setActive(null);
      return;
    }
    let cancelled = false;
    setFiles(null);
    setActive(null);
    setDiff(null);
    setError(null);
    setLoading(true);
    void (async () => {
      try {
        const list = await api.commitFiles(repoId, commitSha);
        if (cancelled) return;
        setFiles(list);
        const matching = commitPath ? list.find((entry) => entry.path === commitPath || entry.oldPath === commitPath) : undefined;
        setActive(matching?.path ?? (commitPath || list[0]?.path) ?? null);
      } catch (caught) {
        if (!cancelled) setError(message(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repoId, commitSha, commitPath]);

  // 取差异：工作区单文件，或提交里选中的文件
  useEffect(() => {
    if (target?.kind !== 'working' && target?.kind !== 'commit') return;
    if (target.kind === 'commit' && !active) return;

    let cancelled = false;
    setDiff(null);
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const result =
          target.kind === 'working'
            ? await api.diff(repoId, target.path, target.staged)
            : await api.commitDiff(
                repoId,
                target.sha,
                active as string,
                files?.find((entry) => entry.path === active)?.oldPath ?? null,
              );
        if (!cancelled) setDiff(result);
      } catch (caught) {
        if (!cancelled) {
          setError(message(caught));
          setDiff(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repoId, target, active, files]);

  // 冲突文件：载入正文到编辑器
  useEffect(() => {
    if (!editorPath) {
      setFile(null);
      setDraft('');
      return;
    }
    let cancelled = false;
    setFile(null);
    setDraft('');
    setSaveNote(null);
    setError(null);
    setLoading(true);
    void (async () => {
      try {
        const loaded = await api.file(repoId, editorPath);
        if (cancelled) return;
        setFile(loaded);
        setDraft(loaded.text);
      } catch (caught) {
        if (!cancelled) setError(message(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repoId, editorPath]);

  if (!target) return null;

  const heading = target.kind === 'commit' ? target.subject : target.path;
  const sub =
    target.kind === 'working'
      ? target.staged
        ? t("暂存区里这个文件的改动")
        : t("工作区里这个文件还没暂存的改动")
      : target.kind === 'conflict'
        ? t("合并冲突：把标记清掉，或直接选一边")
        : target.kind === 'file'
          ? t("工作区文件")
          : t("{0} · {1} · {2} · 这次提交改了哪些文件", target.sha.slice(0, 8), target.authorName, formatDate(target.authoredAt));

  const jump = async (action: 'open' | 'reveal') => {
    const absolute = absolutePath(repoPath, heading);
    if (!absolute || !window.gitatlas) return;
    setJumpError(null);
    const result = action === 'open' ? await window.gitatlas.openPath(absolute) : await window.gitatlas.revealPath(absolute);
    if (!result.ok) setJumpError(result.error ?? t("调用系统程序失败"));
  };

  const save = async () => {
    if (!editorPath || !file?.revision) return;
    setSaving(true);
    setSaveNote(null);
    try {
      const content = /\r\n/.test(file.text) && !/(?<!\r)\n|\r(?!\n)/.test(file.text) ? draft.replace(/\r?\n/g, '\r\n') : draft;
      const result = await api.saveFile(repoId, editorPath, content, file.revision);
      setDraft(content);
      setSaveNote(
        !conflict ? t("文件已保存") : result.conflictMarkers === 0
          ? t("已保存，冲突标记清干净了，点「标记为已解决」")
          : t("已保存，还剩 {0} 段冲突标记", result.conflictMarkers),
      );
      setFile({ ...file, text: content, revision: result.revision, conflictMarkers: result.conflictMarkers });
      onRefreshStatus();
    } catch (caught) {
      setSaveNote(message(caught));
    } finally {
      setSaving(false);
    }
  };

  const markers = file ? (file.text === draft ? file.conflictMarkers : countMarkers(draft)) : 0;

  return (
    <aside className="inspector" aria-label={t("改动检查器")}>
      <div className="inspector-head">
        <div className="inspector-titles">
          <div className="inspector-title" title={heading}>
            {heading}
          </div>
          <div className="inspector-sub">{sub}</div>
        </div>
        <div className="inspector-actions">
          {diff ? (
            <span className="inspector-stat">
              <span className="plus">+{diff.added}</span>
              <span className="minus">−{diff.removed}</span>
            </span>
          ) : null}
          {/* 跳转只对工作区/冲突文件有意义：提交里的 heading 是提交说明，不是路径 */}
          {desktop && target.kind !== 'commit' ? (
            <>
              <button className="btn btn-sm btn-ghost" onClick={() => void jump('open')} title={t("用系统默认程序打开这个文件")}>
                {t("用默认程序打开")}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => void jump('reveal')} title={t("在文件管理器里定位")}>
                {t("在文件夹里显示")}
              </button>
            </>
          ) : null}
          <button className="btn btn-sm btn-ghost" onClick={close} disabled={saving}>
            {t("关闭")}
          </button>
        </div>
      </div>

      {jumpError ? <div className="diff-note">{translateMessage(jumpError)}</div> : null}

      {target.kind === 'commit' ? (
        <div className="inspector-files">
          {files === null ? (
            <div className="empty-desc">{t("正在读取文件清单…")}</div>
          ) : files.length === 0 ? (
            <div className="empty-desc">{t("这次提交没有改动文件")}</div>
          ) : (
            files.map((entry) => (
              <button
                key={entry.path}
                className={`inspector-file${active === entry.path ? ' is-active' : ''}`}
                onClick={() => setActive(entry.path)}
                title={entry.oldPath ? `${entry.oldPath} → ${entry.path}` : entry.path}
              >
                <span className={`inspector-tag t-${entry.status}`}>{t(STATUS_TEXT[entry.status])}</span>
                <span className="inspector-path">{entry.path}</span>
                <span className="inspector-count">
                  {entry.binary ? '—' : `+${entry.added} −${entry.removed}`}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}

      {editorPath ? (
        <>
          <div className="conflict-bar">
            {conflict ? <span className={`conflict-count${markers === 0 ? ' is-clean' : ''}`}>
              {markers === 0 ? t("没有冲突标记") : t("还剩 {0} 段冲突", markers)}
            </span> : null}
            <div className="conflict-actions">
              <button className="btn btn-sm" disabled={busy(saving, loading) || !file?.revision || !dirty} onClick={() => void save()}>
                {saving ? t("保存中…") : t("保存")}
              </button>
              {conflict ? <><button
                className="btn btn-sm btn-ghost"
                disabled={busy(saving, loading)}
                onClick={() => {
                  onGit({ action: 'resolveConflict', path: editorPath, side: 'ours' });
                  onClose();
                }}
              >
                {t("用本地版本")}
              </button>
              <button
                className="btn btn-sm btn-ghost"
                disabled={busy(saving, loading)}
                onClick={() => {
                  onGit({ action: 'resolveConflict', path: editorPath, side: 'theirs' });
                  onClose();
                }}
              >
                {t("用对方版本")}
              </button>
              <button
                className="btn btn-sm btn-accent"
                disabled={busy(saving, loading) || dirty}
                title={dirty ? t("先保存再标记") : t("把文件加入暂存区，冲突即视为解决")}
                onClick={() => {
                  onGit({ action: 'stage', paths: [editorPath] });
                  onClose();
                }}
              >
                {t("标记为已解决")}
              </button></> : null}
            </div>
          </div>
          {saveNote ? <div className="conflict-note">{translateMessage(saveNote)}</div> : null}
          <div className="inspector-editor">
            {error ? <div className="diff-error" role="alert">{translateMessage(error)}</div> : file === null ? (
              <div className="empty-desc">{t("正在读取文件…")}</div>
            ) : file.note && !file.truncated ? (
              <div className="diff-error">{translateMessage(file.note)}</div>
            ) : (
              <textarea
                className="conflict-input"
                spellCheck={false}
                value={draft}
                readOnly={saving || file.truncated}
                onChange={(event) => setDraft(event.target.value)}
                aria-label={conflict ? t("冲突文件内容") : t("文件内容")}
              />
            )}
          </div>
          {file?.truncated && file.note ? <div className="diff-note">{translateMessage(file.note)}</div> : null}
        </>
      ) : (
        <div className="inspector-body">
          <DiffBody diff={diff} loading={loading && !diff} error={error} />
        </div>
      )}
    </aside>
  );
}

function busy(saving: boolean, loading: boolean): boolean {
  return saving || loading;
}

/** 前端也要独立数标记：用户改完还没保存时，按钮状态要跟着变 */
function countMarkers(text: string): number {
  return (text.match(/^<{7}(\s|$)/gm) ?? []).length;
}
