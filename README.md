# GitAtlas（Git 协作图谱）

把仓库里"只有敲命令才看得见"的一切——状态、结构、问题——变成一张能拖、能点、能分享的图。

**三个卖点**：全景可视（所有问题有位置）· 零命令行（全程不碰终端）· 多端可达（桌面便携/安装 · 网页自托管 · 手机主屏）。

- **交付形态**：便携 exe / 安装包 / Docker 自托管 / PWA
- **技术栈**：TypeScript 全栈 —— `core`（Git 分析内核，零运行时依赖）+ Fastify + React/Vite + `node:sqlite` + Electron
- **不做**：自建 git 服务器、CI/CD、替代 GitHub 的 PR 流程

## 快速开始

```bash
pnpm install
pnpm dev        # API   → http://127.0.0.1:4317
pnpm dev:web    # 界面  → http://127.0.0.1:5317
```

打开界面后点「添加仓库」，填入本地 Git 仓库的绝对路径即可。也可以先用 CLI 索引（开发/运维用，产品本身不需要命令行）：

```bash
pnpm atlas index "F:\path\to\repo"
pnpm atlas list
pnpm atlas timeline 1
```

环境变量：`PORT`（默认 4317）、`ATLAS_DB`（默认 `./data/atlas.db`）、`ATLAS_GIT`（指定 git 可执行文件，桌面端注入内置 git 用）。

## 桌面版（推荐）

Windows 双击即用，不需要装 Node、不需要敲任何命令：

| 产物 | 用法 | 数据位置 |
| --- | --- | --- |
| `GitAtlas-Portable-x.y.z.exe` | 便携版，拷到 U 盘也能跑 | exe 同目录的 `data/` |
| `GitAtlas-Setup-x.y.z.exe` | 安装版，带桌面/开始菜单快捷方式 | `%APPDATA%\GitAtlas\data` |

结构上是**一个 Electron 外壳套住同一个服务**：主进程启动内嵌 HTTP 服务（随机端口、只绑
127.0.0.1），窗口加载这个地址。前端与 API 天然同源，所以桌面端和网页端跑的是**同一份前端代码**，
不存在两套实现要维护。

添加仓库时点「选择仓库目录」，走 Windows 原生目录选择器——不用手打路径，这才是"零命令行"。

从源码打包：

```bash
pnpm install
pnpm build:desktop:dir   # 只出未打包目录（约 8 秒），先验证再打包
pnpm build:desktop       # 出便携版 + 安装包，产物在 release/
```

> 打包脚本必须在**真 Node.js** 里跑：Electron 自带的 node 读 app.asar 会报 ENOENT。
> `scripts/build-desktop.mjs` 会自动换成真 node 重跑，无需手工处理。

## 官方仓库与演示仓库

| 仓库 | 用途 | 地址 |
| --- | --- | --- |
| **GitAtlas** | 主仓库，保存产品源码、桌面端和文档 | [github.com/KnifeWen007/GitAtlas](https://github.com/KnifeWen007/GitAtlas) |
| **GitAtlas-Demo** | 官方演示仓库，专门提供分支、合并、标签和冲突样例 | [github.com/KnifeWen007/GitAtlas-Demo](https://github.com/KnifeWen007/GitAtlas-Demo) |

演示仓库的本地路径是 `F:\Projects\GitAtlas-Demo`。把它添加到 GitAtlas 后，可以直接看到：

- `main` 主线和多条已经合并的功能分支
- `feature/mobile-layout` 未合并的开发链
- `demo/conflict-playground` 冲突演示分支
- `v0.1.0`、`v0.2.0`、`v0.3.0-demo` 和 `demo/graph-ready` 等标签
- 操作台中的分支切换、合并、暂存、提交、标签和回滚点

这两个本地仓库已经分别配置了对应的 `origin` 地址；远程内容由仓库所有者自行推送和维护。

## 目录

```
packages/core      Git 读取、索引、聚合（无框架依赖，Node 原生执行 TS）
packages/server    Fastify API，异步索引任务与进度
apps/web           React + Vite 暗色看板
docs/              方案、架构、交互规格、问题规则、账号与部署
```

## 文档

| 文件 | 内容 |
| --- | --- |
| [PLAN.md](./PLAN.md) | 总方案：三支柱、边界、六屏视图、P0–P7 分期 |
| [docs/problem-rules.md](./docs/problem-rules.md) | **问题全景**：28 条检测规则、健康分算法、阈值图形化 |
| [docs/architecture.md](./docs/architecture.md) | 分层架构、Electron 选型对比、内置 git、进程安全、性能预算 |
| [docs/ux-flows.md](./docs/ux-flows.md) | **零命令行**操作映射、拖拽规格、连线视觉规格、移动端手势 |
| [docs/accounts-deploy.md](./docs/accounts-deploy.md) | 账号与权限矩阵、分享链接、四种交付形态、部署安全清单 |
| [docs/data-model.md](./docs/data-model.md) | 表结构、Git 抽取命令、增量刷新、身份归一化 |
| [docs/naming.md](./docs/naming.md) | 命名由来、术语约定、文案语气 |

## 状态

**桌面端、提交图谱和操作台已完成（2026-11-19）**，已经在真实仓库和专用演示仓库上端到端验证：

| 环节 | 结果 |
| --- | --- |
| 索引 | eviacam 817 提交 / 1.6s；img2threejs 368 提交 / 1.1s；GitAtlas-Demo 32 提交 / 1.3s |
| API | health · repos · timeline · refs · commits · graph · status · snapshots · diff · commit-files · commit-diff · git actions · reindex · tasks |
| 界面 | 摘要卡、自适应热力图、SVG 提交图谱、分支与标签、最近提交、可视化操作台 |
| 观察 | 点工作区文件看逐行差异；点图谱任意提交看该次改了哪些文件及每个文件的差异（合并提交按第一父比较） |
| 冲突 | 冲突文件可直接在应用内编辑保存、标记已解决、提交合并结果；也能一键留本地/留对方，或交给系统默认程序打开、在文件夹里定位 |
| 操作 | 获取远端、拉取、推送、切换/新建/合并/删除分支、打标签、暂存、提交、冲突选边、回滚点 |
| 桌面 | Electron 便携版 + 安装版；原生目录选择；内嵌 Fastify；随机本地端口 |
| 质量 | core / server / web 三个包 `tsc --noEmit` 全绿；写操作与差异接口均通过 HTTP 端到端测试 |

### 下一步缺口（按优先级）

1. **增量索引**：目前每次重建全量数据，5 万提交以上会慢（P1）
2. **问题雷达**：规则引擎未实现，`problem-rules.md` 仍是设计（P2）
3. **逐行冲突编辑器**：目前只能整份选择保留本地或对方版本（P2）
4. **任意时刻快照浏览**：现在按提交看差异，还没做"拖时间轴回放历史"（P2）
5. **凭据与账号**：推送依赖系统已有 Git 凭据，账号管理与团队权限仍未接入（P5）
6. **移动端**：移动端布局和 PWA 仍未发布（P6）
7. 热力图跨度超过 2 年时需要横向滚动，后续应按周/月聚合

## 开发约定

- 源码用**显式 `.ts` / `.tsx` 扩展名**导入，配合 Node 原生类型擦除，无需构建即可运行
- `packages/core` 不许依赖 React 或 Electron；`apps/web` 不许 import `packages/server`
- 时间戳一律 ISO 8601 存 UTC，展示层转本地时区
- 任何 `git` 调用都走 `GitReader`，不许硬编码 `'git'`（桌面端要能切到内置 git）
