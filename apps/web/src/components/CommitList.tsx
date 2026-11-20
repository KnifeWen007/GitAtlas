import { useTranslation } from '../i18n.ts';
import type { CommitListItem } from '../api.ts';
import { authorHue, authorInitial, formatDate, formatNumber, formatMonthDay, shortSha } from '../format.ts';

interface CommitListProps {
  commits: CommitListItem[];
  /** 点一行和点图谱一样：看这次提交改了哪些文件 */
  onSelect?: (commit: CommitListItem) => void;
  selectedSha?: string | null;
}

export function CommitList({ commits, onSelect, selectedSha }: CommitListProps) {
  const { t } = useTranslation();
  if (commits.length === 0) {
    return <div className="empty-desc">{t("没有提交记录")}</div>;
  }

  return (
    <div className="commit-list">
      {commits.map((commit) => (
        <div
          className={`commit-row${selectedSha === commit.sha ? ' is-selected' : ''}${
            onSelect ? ' is-clickable' : ''
          }`}
          key={commit.sha}
          role={onSelect ? 'button' : undefined}
          tabIndex={onSelect ? 0 : undefined}
          onClick={() => onSelect?.(commit)}
          onKeyDown={(event) => {
            if (!onSelect) return;
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelect(commit);
            }
          }}
          title={`${commit.sha.slice(0, 8)} · ${commit.authorName} · ${formatDate(commit.authoredAt)}`}
        >
          <span className="commit-sha mono">{shortSha(commit.sha)}</span>
          <span className="commit-main">
            {/* 作者只留一个首字圆点：名字放到 tooltip 里，把宽度让给提交说明 */}
            <span
              className="avatar"
              style={{ ['--avatar-hue' as string]: authorHue(commit.authorName) }}
              title={commit.authorName}
            >
              {authorInitial(commit.authorName)}
            </span>
            <span className="commit-subject">
              {commit.isMerge ? <span className="commit-merge">merge</span> : null}
              {commit.subject}
            </span>
          </span>
          <span className="commit-meta">
            <span>{formatMonthDay(commit.authoredAt)}</span>
            <span className="commit-diff">
              {commit.isMerge && commit.filesChanged === 0 ? (
                <span className="commit-merged">{t("合并提交")}</span>
              ) : (
                <>
                  <i className="plus">+{formatNumber(commit.insertions)}</i>
                  <i className="minus">−{formatNumber(commit.deletions)}</i>
                </>
              )}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
