import { useEffect, useRef, useState } from 'react';
import type { TaskResponse } from '../api.ts';

interface AddRepoDialogProps {
  open: boolean;
  busy: boolean;
  task: TaskResponse | null;
  error: string | null;
  onClose: () => void;
  onSubmit: (path: string) => void;
}

const PHASE_LABEL: Record<string, string> = {
  validating: '校验仓库',
  refs: '扫描分支',
  commits: '解析提交',
  aggregating: '生成聚合',
  done: '完成',
  failed: '失败',
};

export function AddRepoDialog({ open, busy, task, error, onClose, onSubmit }: AddRepoDialogProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // 桌面壳里由 preload 注入；网页版没有，退回手填路径
  const isDesktop = typeof window !== 'undefined' && window.gitatlas?.desktop === true;

  useEffect(() => {
    if (open) {
      setValue('');
      const timer = window.setTimeout(() => {
        if (!isDesktop) inputRef.current?.focus();
      }, 40);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [open, isDesktop]);

  if (!open) return null;

  const submit = () => {
    const path = value.trim();
    if (path.length > 0 && !busy) onSubmit(path);
  };

  const browse = async () => {
    if (busy) return;
    const picked = await window.gitatlas?.pickDirectory();
    if (!picked) return;
    setValue(picked);
    onSubmit(picked);
  };

  const progress = task?.progress;
  const done = progress?.phase === 'done';

  return (
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label="添加仓库">
        <div className="dialog-head">添加仓库</div>
        <div className="dialog-body">
          {isDesktop ? (
            <button
              className="btn btn-primary"
              style={{ width: '100%', padding: '14px 18px', fontSize: 14 }}
              onClick={() => void browse()}
              disabled={busy}
            >
              {busy ? '正在索引…' : '选择仓库目录…'}
            </button>
          ) : (
            <input
              ref={inputRef}
              className="input"
              placeholder="F:\github_projects\your-repo"
              value={value}
              disabled={busy}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
                if (event.key === 'Escape' && !busy) onClose();
              }}
            />
          )}

          <div className="dialog-hint">
            {isDesktop
              ? '选择本地 Git 仓库所在的文件夹，GitAtlas 会直接读取它，不会修改任何文件。'
              : '填入本地 Git 仓库路径。'}
          </div>

          {isDesktop && value ? (
            <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', wordBreak: 'break-all' }}>
              {value}
            </div>
          ) : null}

          {task && progress ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: 'var(--text-dim)' }}>
                  {PHASE_LABEL[progress.phase] ?? progress.phase} · {progress.message}
                </span>
                {progress.processed > 0 ? (
                  <span className="mono" style={{ color: 'var(--text-faint)' }}>
                    {progress.processed}
                  </span>
                ) : null}
              </div>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{
                    width: done ? '100%' : busy ? '62%' : '8%',
                    transition: 'width 400ms ease',
                  }}
                />
              </div>
            </div>
          ) : null}

          {error ? <div className="error-text">{error}</div> : null}
        </div>

        <div className="dialog-foot">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {busy ? '后台继续' : '取消'}
          </button>
          {isDesktop ? null : (
            <button className="btn btn-primary" onClick={submit} disabled={busy || value.trim().length === 0}>
              {busy ? (
                <>
                  <span className="spinner" /> 索引中
                </>
              ) : (
                '开始索引'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
