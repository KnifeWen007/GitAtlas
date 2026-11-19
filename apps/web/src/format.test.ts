import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  authorHue,
  authorInitial,
  formatMonthDay,
  formatNumber,
  formatRelative,
  longestStreak,
  shortSha,
  webUrlOf,
  weeklyBuckets,
} from './format.ts';

test('formatNumber 一万以下用千分位，以上换成"万"', () => {
  assert.equal(formatNumber(0), '0');
  assert.equal(formatNumber(9999), '9,999');
  assert.equal(formatNumber(10000), '1.0 万');
  assert.equal(formatNumber(123456), '12.3 万');
  assert.equal(formatNumber(1234567), '123 万');
  assert.equal(formatNumber(Number.NaN), '—');
});

test('formatNumber 负数保留符号', () => {
  assert.equal(formatNumber(-12345), '-1.2 万');
  assert.equal(formatNumber(-42), '-42');
});

test('formatMonthDay 只看月日，非法输入给占位符', () => {
  // 本地时间中午，避免时区把日期推到前一天
  const noon = new Date(2026, 0, 5, 12, 0, 0);
  assert.equal(formatMonthDay(noon.toISOString()), '01-05');
  assert.equal(formatMonthDay(null), '—');
  assert.equal(formatMonthDay('不是日期'), '—');
});

test('formatRelative 按分钟/小时/天递进', () => {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  assert.equal(formatRelative(ago(30_000)), '刚刚');
  assert.equal(formatRelative(ago(5 * 60_000)), '5 分钟前');
  assert.equal(formatRelative(ago(3 * 3_600_000)), '3 小时前');
  assert.equal(formatRelative(ago(2 * 86_400_000)), '2 天前');
  assert.equal(formatRelative(null), '从未');
});

test('shortSha 取前七位', () => {
  assert.equal(shortSha('553c999abcdef0123456'), '553c999');
});

test('weeklyBuckets 把每天折叠成每周，越新的周越靠右', () => {
  const days = [
    { date: '2026-01-01', commits: 1 },
    { date: '2026-01-08', commits: 3 },
    { date: '2026-01-15', commits: 2 },
  ];
  assert.deepEqual(weeklyBuckets(days, 3), [1, 3, 2]);
});

test('weeklyBuckets 丢掉窗口之外的旧数据', () => {
  const days = [
    { date: '2025-12-01', commits: 9 },
    { date: '2026-01-15', commits: 4 },
  ];
  assert.deepEqual(weeklyBuckets(days, 2), [0, 4]);
  assert.deepEqual(weeklyBuckets([], 4), []);
});

test('longestStreak 数的是连续活跃天，不是总活跃天', () => {
  assert.equal(
    longestStreak([
      { date: '2026-01-01', commits: 1 },
      { date: '2026-01-02', commits: 2 },
      { date: '2026-01-03', commits: 0 },
      { date: '2026-01-04', commits: 1 },
      { date: '2026-01-05', commits: 1 },
      { date: '2026-01-06', commits: 1 },
    ]),
    3,
  );
  assert.equal(longestStreak([]), 0);
});

test('authorInitial 取最后一段的首字，中英文都不炸', () => {
  assert.equal(authorInitial('GitAtlas Demo Bot'), 'B');
  assert.equal(authorInitial('knife'), 'K');
  assert.equal(authorInitial('  张三  '), '张');
  assert.equal(authorInitial('jane.doe'), 'D');
  assert.equal(authorInitial('   '), '?');
});

test('authorHue 同一个名字永远同一色相，且避开正红', () => {
  assert.equal(authorHue('GitAtlas Demo Bot'), authorHue('GitAtlas Demo Bot'));
  assert.notEqual(authorHue('alice'), authorHue('bob'));
  for (const name of ['alice', 'bob', '张三', 'x', '一个很长很长的作者名字']) {
    const hue = authorHue(name);
    assert.ok(hue >= 0 && hue < 360, `${name} 的色相越界: ${hue}`);
    assert.ok(hue > 20 && hue < 340, `${name} 的色相落进了红色区: ${hue}`);
  }
});

test('webUrlOf 认得 ssh / scp / https 三种写法', () => {
  assert.equal(webUrlOf('git@github.com:KnifeWen007/GitAtlas.git'), 'https://github.com/KnifeWen007/GitAtlas');
  assert.equal(webUrlOf('git@github.com:KnifeWen007/GitAtlas'), 'https://github.com/KnifeWen007/GitAtlas');
  assert.equal(webUrlOf('ssh://git@gitlab.com/group/repo.git'), 'https://gitlab.com/group/repo');
  assert.equal(webUrlOf('https://github.com/a/b.git'), 'https://github.com/a/b');
  assert.equal(webUrlOf('  https://github.com/a/b  '), 'https://github.com/a/b');
});

test('webUrlOf 认不出来的地址不硬编链接', () => {
  assert.equal(webUrlOf(''), null);
  assert.equal(webUrlOf('/srv/git/repo.git'), null);
  assert.equal(webUrlOf('file:///srv/git/repo.git'), null);
});
