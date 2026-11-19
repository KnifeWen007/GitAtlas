/**
 * 通过 CDP 检查正在运行的桌面端：验证 preload 注入、页面渲染与内嵌 API。
 * 用法：node data/cdp-check.mjs [port]
 */
import fs from 'node:fs';

const port = Number(process.argv[2] ?? 9333);

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) {
  console.error('没有找到页面 target：', JSON.stringify(list.map((t) => t.type)));
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
  setTimeout(() => reject(new Error('WebSocket 连接超时')), 8000);
});

const probe = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    url: location.href,
    title: document.title,
    desktopBridge: typeof window.gitatlas === 'object' && window.gitatlas !== null,
    bridgeKeys: Object.keys(window.gitatlas || {}),
    canPick: typeof window.gitatlas?.pickDirectory === 'function',
    repoCount: document.querySelectorAll('.repo-item').length,
    bodyText: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 240)
  })`,
  returnByValue: true,
});

console.log(probe.result?.result?.value ?? JSON.stringify(probe));

const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result?.data) {
  fs.writeFileSync('F:/GitAtlas/data/cdp-shot.png', Buffer.from(shot.result.data, 'base64'));
  console.log('截图已保存：data/cdp-shot.png');
}

ws.close();
