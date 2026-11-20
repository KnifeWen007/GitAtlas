import { getLanguage, translate } from './i18n.ts';

const englishNumbers = new Intl.NumberFormat('en', { notation: 'compact' });

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (getLanguage() === 'en') return englishNumbers.format(value);
  // 中文语境里「1.2 万」比「12.3k」更好读，超过一万就换单位
  if (Math.abs(value) >= 10000) {
    const wan = value / 10000;
    return `${wan >= 100 ? Math.round(wan) : wan.toFixed(1)} 万`;
  }
  return value.toLocaleString('zh-CN');
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 列表里只留「月-日」：同一屏几十行都带年份，四个数字纯属噪音。
 * 完整日期放在 title 里，需要时仍能看到。
 */
export function formatMonthDay(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatRelative(iso: string | null): string {
  const language = getLanguage();
  const t = (source: string, ...values: unknown[]) => translate(language, source, ...values);
  if (!iso) return t("从未");
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return t("刚刚");
  if (min < 60) return t("{0} 分钟前", min);
  const hour = Math.floor(min / 60);
  if (hour < 24) return t("{0} 小时前", hour);
  const day = Math.floor(hour / 24);
  if (day < 30) return t("{0} 天前", day);
  const month = Math.floor(day / 30);
  if (month < 12) return t("{0} 个月前", month);
  return t("{0} 年前", Math.floor(month / 12));
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/** 最近 N 周每周的提交数，用来画统计卡里的小火花线 */
export function weeklyBuckets(days: Array<{ date: string; commits: number }>, weeks = 12): number[] {
  if (days.length === 0) return [];
  const buckets = new Array<number>(weeks).fill(0);
  const newest = new Date(`${days[days.length - 1]!.date}T00:00:00Z`).getTime();
  const dayMs = 86_400_000;
  for (const day of days) {
    const time = new Date(`${day.date}T00:00:00Z`).getTime();
    if (Number.isNaN(time)) continue;
    // 从最新一天往回数第几周：0 是最近 7 天
    const weeksAgo = Math.floor((newest - time) / (dayMs * 7));
    if (weeksAgo < 0 || weeksAgo >= weeks) continue;
    const slot = weeks - 1 - weeksAgo;
    buckets[slot] = (buckets[slot] ?? 0) + day.commits;
  }
  return buckets;
}

/** 最长连续提交天数：分母是"活跃天"，比"总天数"更说明节奏 */
export function longestStreak(days: Array<{ date: string; commits: number }>): number {
  let best = 0;
  let current = 0;
  for (const day of days) {
    if (day.commits > 0) {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  }
  return best;
}

/** 作者名 → 头像首字：中英文都取最后一个词的首字符，尽量区分开 */
export function authorInitial(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return '?';
  const parts = trimmed.split(/[\s._-]+/).filter(Boolean);
  const last = parts[parts.length - 1] ?? trimmed;
  return Array.from(last)[0]?.toUpperCase() ?? '?';
}

/** 同一个作者永远同一个色相，换仓库也不会变色 */
export function authorHue(name: string): number {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 360;
  }
  // 避开正红区（350–20），那个色相在深色底上像报错
  const hue = (hash + 30) % 360;
  return hue > 340 ? hue - 40 : hue;
}

/**
 * 把 git 支持的几种远端写法还原成能点开的网页地址。
 * 认不出来（本地路径、奇怪协议）就返回 null，不要硬编一个假链接。
 */
export function webUrlOf(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  if (trimmed === '') return null;
  const ssh = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(trimmed);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  const sshProtocol = /^ssh:\/\/git@([^/]+)\/(.+?)(?:\.git)?$/.exec(trimmed);
  if (sshProtocol) return `https://${sshProtocol[1]}/${sshProtocol[2]}`;
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\.git$/, '');
  return null;
}
