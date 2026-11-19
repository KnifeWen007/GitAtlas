/**
 * 端到端验证桌面端：页脚地址、添加仓库、索引进度、数据渲染。
 * 用法：node data/cdp-flow.mjs [port] [repoPath]
 */
import fs from 'node:fs';

const port = Number(process.argv[2] ?? 9333);
const repoPath = process.argv[3] ?? 'F:\\github_projects\\img2threejs';

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) {
  console.error('没有页面 target');
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let seq = 0;

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve);
  ws.addEventListener('error', reject);
  setTimeout(() => reject(new Error('连接超时')), 8000);
});

async function evaluate(expression, awaitPromise = false) {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  const result = res.result?.result;
  if (res.result?.exceptionDetails) {
    return `EXCEPTION: ${res.result.exceptionDetails.text} ${result?.description ?? ''}`;
  }
  return result?.value;
}

console.log('页脚：', await evaluate(`document.querySelector('.sidebar-footer')?.innerText.replace(/\\n/g, ' | ')`));

const added = await evaluate(
  `fetch('/api/repos', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ path: ${JSON.stringify(repoPath)} })
   }).then(r => r.json()).then(j => JSON.stringify(j))`,
  true,
);
console.log('添加仓库响应：', added);

let taskId = null;
try {
  taskId = JSON.parse(added).taskId;
} catch {
  console.error('添加仓库失败，后续步骤跳过');
}

if (taskId) {
  for (let i = 0; i < 100; i++) {
    const status = await evaluate(
      `fetch('/api/tasks/${taskId}').then(r => r.json()).then(t => JSON.stringify({ s: t.status, m: t.progress.message }))`,
      true,
    );
    const parsed = JSON.parse(status);
    if (parsed.s !== 'running') {
      console.log('索引结果：', parsed.s, '|', parsed.m);
      break;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

await send('Page.reload', { ignoreCache: true });
await new Promise((r) => setTimeout(r, 4000));

const summary = await evaluate(`JSON.stringify({
  repoItems: document.querySelectorAll('.repo-item').length,
  cards: Array.from(document.querySelectorAll('.stat-card')).map(c => c.innerText.replace(/\\n/g, ' ')).slice(0, 6),
  footer: document.querySelector('.sidebar-footer')?.innerText.replace(/\\n/g, ' | '),
  heatCells: document.querySelectorAll('.heat-cell, rect[data-level]').length
})`);
console.log('页面状态：', summary);

const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result?.data) {
  fs.writeFileSync('F:/GitAtlas/data/cdp-flow.png', Buffer.from(shot.result.data, 'base64'));
  console.log('截图：data/cdp-flow.png');
}

ws.close();
