import { useTranslation } from '../i18n.ts';
import { useMemo, useState } from 'react';
import type { GitActionBody, RepoStatus } from '../api.ts';
import {
  COMMIT_TYPES,
  buildCommitMessage,
  parseConventional,
  type CommitDraft,
  type CommitType,
} from '../commit-format.ts';

interface CommitComposerProps {
  status: RepoStatus;
  busy: boolean;
  onRun: (body: GitActionBody) => void;
}

/**
 * 按规范写提交：点类型、填一句话，右边实时显示最终那行长什么样。
 *
 * 规范不是靠提醒，是靠入口——把类型做成必选项，顺手就写对了。
 */
export function CommitComposer({ status, busy, onRun }: CommitComposerProps) {
  const { t } = useTranslation();
  const stagedCount = status.staged.length;
  const allCount = status.staged.length + status.unstaged.length + status.untracked.length;

  const [type, setType] = useState<CommitType>('feat');
  const [scope, setScope] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [breaking, setBreaking] = useState(false);
  const [more, setMore] = useState(false);
  const [includeAll, setIncludeAll] = useState(stagedCount === 0);

  const draft: CommitDraft = { type, scope, subject, body, breaking };
  const message = useMemo(() => buildCommitMessage(draft), [type, scope, subject, body, breaking]);
  const preview = parseConventional(message);
  const tooLong = subject.trim().length > 72;
  const ready = subject.trim().length > 0 && (includeAll ? allCount > 0 : stagedCount > 0);

  const submit = () => {
    if (!ready) return;
    onRun({ action: 'commit', message, all: includeAll });
    setSubject('');
    setBody('');
    setScope('');
    setBreaking(false);
  };

  return (
    <div className="commit-box">
      <div className="commit-types" role="radiogroup" aria-label={t("提交类型")}>
        {COMMIT_TYPES.map((item) => (
          <button
            key={item.type}
            type="button"
            role="radio"
            aria-checked={type === item.type}
            className={`ctype-pick ctype-${item.type} ${type === item.type ? 'is-on' : ''}`}
            title={t(item.hint)}
            disabled={busy}
            onClick={() => setType(item.type)}
          >
            {item.type}
          </button>
        ))}
      </div>

      <div className="commit-line">
        <span className="commit-fixed">{type}</span>
        <span className="commit-paren">(</span>
        <input
          className="commit-scope"
          placeholder={t("范围")}
          value={scope}
          onChange={(event) => setScope(event.target.value)}
          disabled={busy}
          aria-label={t("影响范围")}
        />
        <span className="commit-paren">)</span>
        <span className="commit-colon">:</span>
        <input
          className="op-input commit-subject"
          placeholder={t("一句话说清这次改了什么")}
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) submit();
          }}
          disabled={busy}
          aria-label={t("提交标题")}
        />
        <label className="commit-break" title={t("不兼容的改动，标题后面会多一个感叹号")}>
          <input
            type="checkbox"
            checked={breaking}
            onChange={(event) => setBreaking(event.target.checked)}
            disabled={busy}
          />
          BREAKING
        </label>
      </div>

      <div className="commit-preview">
        <code className={preview ? `ctype-${preview.type}` : ''}>{message || 'feat: …'}</code>
        {tooLong ? <span className="commit-warn">{t("标题超过 72 字，历史里会被截断")}</span> : null}
      </div>

      {more ? (
        <textarea
          className="op-input commit-body"
          placeholder={t("补充说明：为什么改、影响什么、怎么迁移（可选）")}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          disabled={busy}
          rows={3}
        />
      ) : null}

      <div className="commit-actions">
        <button className="btn btn-xs btn-ghost" type="button" onClick={() => setMore((value) => !value)}>
          {more ? t("收起正文") : t("加正文")}
        </button>
        <div className="commit-mode">
          <label className={stagedCount === 0 ? 'is-dim' : ''}>
            <input
              type="radio"
              name="commit-mode"
              checked={!includeAll}
              onChange={() => setIncludeAll(false)}
              disabled={busy || stagedCount === 0}
            />
            {t("只提交已暂存（")}{stagedCount}）
          </label>
          <label>
            <input
              type="radio"
              name="commit-mode"
              checked={includeAll}
              onChange={() => setIncludeAll(true)}
              disabled={busy || allCount === 0}
            />
            {t("提交全部改动（")}{allCount}）
          </label>
        </div>
        <button className="btn btn-sm btn-accent commit-submit" type="button" disabled={busy || !ready} onClick={submit}>
          {t("按规范提交")}
        </button>
      </div>

      {!ready ? (
        <div className="commit-hint">
          {subject.trim().length === 0
            ? t("先填一句标题，标题会原样出现在图谱上")
            : includeAll
              ? t("工作区没有可提交的改动")
              : t("暂存区是空的：先在上面的文件上点「暂存」，或者改成提交全部改动")}
        </div>
      ) : null}
    </div>
  );
}
