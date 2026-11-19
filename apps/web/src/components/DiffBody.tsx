import type { FileDiff } from '../api.ts';

interface DiffBodyProps {
  diff: FileDiff | null;
  loading: boolean;
  error: string | null;
}

/** 逐行差异：左侧旧/新行号，右侧正文，增删用底色区分 */
export function DiffBody({ diff, loading, error }: DiffBodyProps) {
  if (loading) {
    return (
      <div className="empty-desc">
        <div className="spinner" />
        正在读取差异…
      </div>
    );
  }

  if (error) return <div className="diff-error">{error}</div>;
  if (!diff) return <div className="empty-desc">选一个文件，看它改了什么</div>;
  if (diff.lines.length === 0) return <div className="empty-desc">{diff.note ?? '这个文件没有可显示的差异'}</div>;

  return (
    <div className="diff-body">
      {diff.note ? <div className="diff-note">{diff.note}</div> : null}
      <div className="diff-lines">
        {diff.lines.map((line, index) => (
          <div key={`${index}-${line.kind}`} className={`diff-line ${line.kind}`}>
            <span className="diff-no">{line.oldLine ?? ''}</span>
            <span className="diff-no">{line.newLine ?? ''}</span>
            <span className="diff-sign">
              {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
            </span>
            <code className="diff-text">{line.text.length > 0 ? line.text : ' '}</code>
          </div>
        ))}
      </div>
    </div>
  );
}
