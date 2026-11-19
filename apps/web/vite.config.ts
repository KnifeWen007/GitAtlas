import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 端口由外部传入：开发模式会和宿主程序、其它 dev 服务抢端口，
 * 写死 5317 一旦被占就只能手动改代码。
 */
const apiPort = process.env.ATLAS_API_PORT ?? '4317';
const webPort = Number(process.env.ATLAS_WEB_PORT ?? '5317');

export default defineConfig({
  plugins: [react()],
  server: {
    port: webPort,
    strictPort: true,
    host: '127.0.0.1',
    // 编辑器/工具链的原子写入会短暂产生 .xxx.tmpdir 与 *.tmp，
    // chokidar 去 watch 它们会抛 EBUSY 并终止 dev server，这里直接忽略。
    watch: {
      ignored: ['**/.*.tmpdir', '**/.*.tmpdir/**', '**/*.tmp', '**/data/**'],
    },
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
