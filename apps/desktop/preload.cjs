'use strict';

/**
 * preload：桌面壳向页面暴露的唯一入口。
 *
 * 数据仍然全部走 HTTP，这里只暴露"外壳才有的能力"——
 * 目前只有系统目录选择器，它是"零命令行"的关键：用户点按钮选仓库，而不是手打路径。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gitatlas', {
  desktop: true,
  platform: process.platform,
  version: process.env.npm_package_version || '0.1.0',
  /** 返回选中的目录绝对路径；用户取消时返回 null */
  pickDirectory: () => ipcRenderer.invoke('gitatlas:pick-directory'),
});
