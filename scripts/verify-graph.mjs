/** 检查提交图谱渲染情况 */
import fs from 'node:fs';

const port = Number(process.argv[2] ?? 9333);
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let seq = 0;

ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

await new Promise((r) => ws.addEventListener('open', r));

const res = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    rows: document.querySelectorAll('.graph-row').length,
    paths: document.querySelectorAll('.graph-svg path').length,
    nodes: document.querySelectorAll('.graph-svg circle').length,
    refs: Array.from(document.querySelectorAll('.gref')).slice(0, 6).map(e => e.textContent),
    legend: document.querySelector('.graph-legend')?.innerText.replace(/\\n/g, ' '),
    firstRow: document.querySelector('.graph-row')?.innerText.replace(/\\n/g, ' | ')
  })`,
  returnByValue: true,
});
console.log(res.result?.result?.value);

const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result?.data) {
  fs.writeFileSync('F:/GitAtlas/data/cdp-graph.png', Buffer.from(shot.result.data, 'base64'));
  console.log('截图：data/cdp-graph.png');
}
ws.close();
