import { useEffect, useState } from 'react';
import { api, type CommitFile, type FileDiff } from '../api.ts';
import { formatDate } from '../format.ts';
import { DiffBody } from './DiffBody.tsx';

export type InspectTarget =
  | { kind: 'working'; path: string; staged: boolean }
  | { kind: 'commit'; sha: string; subject: string; authorName: string; authoredAt: string };

interface InspectorDrawerProps {
  repoId: number;
  target: InspectTarget | null;
  onClose: () => void;
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

/**
 * 右侧检查器：工作区点文件看差异，图谱点提交看这次改了哪些文件。
 * 两种入口共用同一个抽屉，避免屏幕上出现两套"看改动"的地方。
 */
export function InspectorDrawer({ repoId, target, onClose }: InspectorDrawerProps) {
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [files, setFiles] = useState<CommitFile[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commitSha = target?.kind === 'commit' ? target.sha : null;
  const workingPath = target?.kind === 'working' ? target.path : null;
  const workingStaged = target?.kind === 'working' ? target.staged : false;

  // Esc 关闭
  useEffect(() => {
    if (!target) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, onClose]);

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
        setActive(list[0]?.path ?? null);
      } catch (caught) {
        if (!cancelled) setError(message(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repoId, commitSha]);

  // 取差异：工作区单文件，或提交里选中的文件
  useEffect(() => {
    if (!target) return;
    if (target.kind === 'commit' && !active) return;

    let cancelled = false;
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
                files?.find((file) => file.path === active)?.oldPath ?? null,
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

  if (!target) return null;

  const heading = target.kind === 'working' ? target.path : target.subject;
  const sub =
    target.kind === 'working'
      ? target.staged
        ? '暂存区里这个文件的改动'
        : '工作区里这个文件还没暂存的改动'
      : `${target.sha.slice(0, 8)} · ${target.authorName} · ${formatDate(target.authoredAt)} · 这次提交改了哪些文件`;

  return (
    <aside className="inspector" aria-label="改动检查器">
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
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>

      {target.kind === 'commit' ? (
        <div className="inspector-files">
          {files === null ? (
            <div className="empty-desc">正在读取文件清单…</div>
          ) : files.length === 0 ? (
            <div className="empty-desc">这次提交没有改动文件</div>
          ) : (
            files.map((file) => (
              <button
                key={file.path}
                className={`inspector-file${active === file.path ? ' is-active' : ''}`}
                onClick={() => setActive(file.path)}
                title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
              >
                <span className={`inspector-tag t-${file.status}`}>{STATUS_TEXT[file.status]}</span>
                <span className="inspector-path">{file.path}</span>
                <span className="inspector-count">
                  {file.binary ? '—' : `+${file.added} −${file.removed}`}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}

      <div className="inspector-body">
        <DiffBody diff={diff} loading={loading && !diff} error={error} />
      </div>
    </aside>
  );
}
