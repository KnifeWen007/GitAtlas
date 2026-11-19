import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5317,
    host: '127.0.0.1',
    // 编辑器/工具链的原子写入会短暂产生 .xxx.tmpdir 与 *.tmp，
    // chokidar 去 watch 它们会抛 EBUSY 并终止 dev server，这里直接忽略。
    watch: {
      ignored: ['**/.*.tmpdir', '**/.*.tmpdir/**', '**/*.tmp', '**/data/**'],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4317',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
