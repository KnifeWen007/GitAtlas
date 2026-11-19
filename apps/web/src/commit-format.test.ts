import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCommitMessage, COMMIT_TYPES, parseConventional, type CommitDraft } from './commit-format.ts';

test('parseConventional 拆出类型、范围、破坏性标记和说明', () => {
  assert.deepEqual(parseConventional('feat(operations): make the operation panel the default entry'), {
    type: 'feat',
    scope: 'operations',
    breaking: false,
    description: 'make the operation panel the default entry',
  });
});

test('parseConventional 没有范围时 scope 是 null', () => {
  const parsed = parseConventional('fix: 修掉分支列表的空格');
  assert.equal(parsed?.type, 'fix');
  assert.equal(parsed?.scope, null);
  assert.equal(parsed?.description, '修掉分支列表的空格');
});

test('parseConventional 认得出感叹号，也容忍大小写和多余空格', () => {
  const parsed = parseConventional('  Feat(Graph)!:  支持拖动节点  ');
  assert.equal(parsed?.type, 'feat');
  assert.equal(parsed?.scope, 'Graph');
  assert.equal(parsed?.breaking, true);
  assert.equal(parsed?.description, '支持拖动节点');
});

test('parseConventional 不是约定格式就返回 null', () => {
  assert.equal(parseConventional('merge: add the health radar baseline'), null);
  assert.equal(parseConventional('update readme'), null);
  assert.equal(parseConventional('wip: 还差点东西'), null);
  assert.equal(parseConventional(''), null);
});

test('约定的类型都在列表里，角标才有提示文案', () => {
  for (const meta of COMMIT_TYPES) {
    assert.ok(meta.hint.length > 0, `${meta.type} 缺少说明`);
    assert.equal(parseConventional(`${meta.type}: x`)?.type, meta.type);
  }
});

test('buildCommitMessage 拼出规范标题', () => {
  const draft: CommitDraft = {
    type: 'feat',
    scope: 'graph',
    subject: '支持拖动节点',
    body: '',
    breaking: false,
  };
  assert.equal(buildCommitMessage(draft), 'feat(graph): 支持拖动节点');
});

test('buildCommitMessage 没有范围时不留空括号，正文用空行隔开', () => {
  const draft: CommitDraft = {
    type: 'docs',
    scope: '   ',
    subject: '  补一段说明  ',
    body: '  第一行\n第二行  ',
    breaking: false,
  };
  assert.equal(buildCommitMessage(draft), 'docs: 补一段说明\n\n第一行\n第二行');
});

test('buildCommitMessage 会清掉范围里手打的括号，并保留破坏性标记', () => {
  const draft: CommitDraft = {
    type: 'refactor',
    scope: '(store)',
    subject: '拆开索引写入',
    body: '',
    breaking: true,
  };
  assert.equal(buildCommitMessage(draft), 'refactor(store)!: 拆开索引写入');
});

test('buildCommitMessage 的结果能被 parseConventional 读回来', () => {
  const message = buildCommitMessage({
    type: 'perf',
    scope: 'heatmap',
    subject: '少画一半格子',
    body: '按周聚合',
    breaking: false,
  });
  const [head] = message.split('\n');
  const parsed = parseConventional(head ?? '');
  assert.equal(parsed?.type, 'perf');
  assert.equal(parsed?.scope, 'heatmap');
  assert.equal(parsed?.description, '少画一半格子');
});
