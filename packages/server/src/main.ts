import { resolve } from 'node:path';
import { startServer } from './app.ts';

/**
 * 独立运行入口（Web / 服务器模式）。
 * 桌面端不使用此文件，直接调用 app.ts 的 startServer。
 */
const dbPath = process.env.ATLAS_DB ?? resolve(process.cwd(), 'data', 'atlas.db');

const handle = await startServer({
  dbPath,
  port: Number(process.env.PORT ?? 4317),
  host: process.env.HOST ?? '127.0.0.1',
  ...(process.env.ATLAS_GIT ? { gitPath: process.env.ATLAS_GIT } : {}),
  ...(process.env.ATLAS_STATIC ? { staticDir: process.env.ATLAS_STATIC } : {}),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  enableCors: true,
});

handle.app.log.info(`GitAtlas API → ${handle.url}  (db: ${dbPath})`);

const shutdown = async (signal: string): Promise<void> => {
  handle.app.log.info(`收到 ${signal}，正在关闭`);
  await handle.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
