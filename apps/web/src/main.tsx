import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { applyTheme, loadTheme, loadThemeAsync } from './theme.ts';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('找不到 #root 挂载点');
const root = container;

async function bootstrap() {
  // 先上色再渲染，避免打开时先闪一下默认深色
  applyTheme(loadTheme());

  // 桌面端配色存在 userData 里，读回来再渲染一次，首帧就是上次选的那套
  const settings = await loadThemeAsync();
  applyTheme(settings);

  createRoot(root).render(
    <StrictMode>
      <App initialTheme={settings} />
    </StrictMode>,
  );
}

void bootstrap();
