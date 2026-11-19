import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { applyTheme, loadTheme } from './theme.ts';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('找不到 #root 挂载点');

// 先上色再渲染，避免打开时先闪一下默认深色
applyTheme(loadTheme());

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
