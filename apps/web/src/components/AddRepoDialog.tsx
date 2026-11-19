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

  useEffect(() => {
    if (open) {
      setValue('');
      const timer = window.setTimeout(() => inputRef.current?.focus(), 40);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [open]);

  if (!open) return null;

  const submit = () => {
    const path = value.trim();
    if (path.length > 0) onSubmit(path);
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
          <div className="dialog-hint">
            填入本地 Git 仓库路径。桌面版会替换为系统目录选择器，网页版先用路径输入。
          </div>

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
            取消
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || value.trim().length === 0}>
            {busy ? (
              <>
                <span className="spinner" /> 索引中
              </>
            ) : (
              '开始索引'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
