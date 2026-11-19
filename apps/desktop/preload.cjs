'use strict';

/**
 * preload：桌面壳向页面暴露的唯一入口。
 *
 * 数据仍然全部走 HTTP，这里只暴露"外壳才有的能力"——
 * 系统目录选择器（"零命令行"的关键），以及把文件交给系统默认程序打开。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gitatlas', {
  desktop: true,
  platform: process.platform,
  version: process.env.npm_package_version || '0.1.0',
  /** 返回选中的目录绝对路径；用户取消时返回 null */
  pickDirectory: () => ipcRenderer.invoke('gitatlas:pick-directory'),
  /** 用系统默认程序打开文件，返回 { ok, error? } */
  openPath: (filePath) => ipcRenderer.invoke('gitatlas:open-path', filePath),
  /** 在文件管理器里定位文件 */
  revealPath: (filePath) => ipcRenderer.invoke('gitatlas:reveal-path', filePath),
  /** 读回配色设置；桌面端存在 userData/theme.json，换端口也不会丢 */
  readTheme: () => ipcRenderer.invoke('gitatlas:theme-read'),
  /** 保存配色设置 */
  writeTheme: (settings) => ipcRenderer.invoke('gitatlas:theme-write', settings),
});
