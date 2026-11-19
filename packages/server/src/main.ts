import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { startServer } from './app.ts';

/**
 * 独立运行入口（Web / 服务器模式）。
 * 桌面端不使用此文件，直接调用 app.ts 的 startServer。
 */
const dbPath = process.env.ATLAS_DB ?? resolve(process.cwd(), 'data', 'atlas.db');
const port = Number(process.env.PORT ?? 4317);
const host = process.env.HOST ?? '127.0.0.1';

/**
 * 等端口空出来再启动。
 *
 * `node --watch` 看到文件变化会立刻拉起新进程，而上一轮进程可能还没把
 * 监听套接字放掉，新进程直接 EADDRINUSE —— 改一行服务端代码就"启动失败"，
 * 看起来像代码坏了，其实只是抢端口。这里先等一小会儿，正常情况几十毫秒就放开了。
 */
async function waitForPortFree(targetPort: number, targetHost: string, timeoutMs = 6000): Promise<boolean> {
  const started = Date.now();
  let waited = false;
  for (;;) {
    const free = await new Promise<boolean>((resolveFree) => {
      const probe = createServer();
      probe.once('error', () => resolveFree(false));
      probe.once('listening', () => probe.close(() => resolveFree(true)));
      probe.listen(targetPort, targetHost);
    });
    if (free) {
      if (waited) console.log(`端口 ${targetPort} 已空出来，继续启动`);
      return true;
    }
    if (Date.now() - started > timeoutMs) return false;
    if (!waited) {
      waited = true;
      console.log(`端口 ${targetPort} 还被上一个进程占着，等它放开…`);
    }
    await new Promise((resume) => setTimeout(resume, 200));
  }
}

const portFree = await waitForPortFree(port, host);

let handle;
try {
  handle = await startServer({
    dbPath,
    port,
    host,
    ...(process.env.ATLAS_GIT ? { gitPath: process.env.ATLAS_GIT } : {}),
    ...(process.env.ATLAS_STATIC ? { staticDir: process.env.ATLAS_STATIC } : {}),
    logLevel: process.env.LOG_LEVEL ?? 'info',
    enableCors: true,
  });
} catch (error) {
  if ((error as { code?: string })?.code === 'EADDRINUSE') {
    console.error(
      `端口 ${port} 被占用${portFree ? '' : '（等了 6 秒也没空出来）'}。` +
        `多半是上一次的开发服务还没退干净：关掉它，或者换端口：$env:PORT=4318`,
    );
    process.exit(1);
  }
  throw error;
}

handle.app.log.info(`GitAtlas API → ${handle.url}  (db: ${dbPath})`);

/**
 * 退出时必须"说到做到"。
 *
 * Fastify 的 close() 会等现存连接自然断开，而桌面窗口用的是 keep-alive，
 * 开发时这个等待可能永远不结束：旧进程不走，新进程就抢不到端口，还会一路堆积。
 * 所以给它几百毫秒，关不掉就直接退。
 */
const shutdown = (signal: string): void => {
  handle.app.log.info(`收到 ${signal}，正在关闭`);
  const force = setTimeout(() => process.exit(0), 800);
  force.unref();
  void handle
    .close()
    .catch(() => undefined)
    .finally(() => process.exit(0));
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
