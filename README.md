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

**P0 完成（2026-11-19）**，已在真实仓库上端到端验证：

| 环节 | 结果 |
| --- | --- |
| 索引 | eviacam 817 提交 / 1.6s；img2threejs 368 提交 / 1.1s |
| API | health · repos · timeline · refs · commits · reindex · tasks |
| 界面 | 摘要卡、自适应热力图、分支与标签（含远端折叠）、最近提交 |
| 质量 | core / server / web 三个包 `tsc --noEmit` 全绿 |

### 已知缺口（按优先级）

1. **增量索引**：目前每次重建全量数据，5 万提交以上会慢（P1）
2. **DAG 拓扑图**：尚未开始，这是最有辨识度的一屏（P1）
3. **问题雷达**：规则引擎未实现，`problem-rules.md` 只有设计（P2）
4. **写操作**：fetch/merge/冲突解决器全未开始（P3）
5. **桌面壳与打包**：未开始（P4）
6. **移动端**：未开始（P6）
7. 热力图跨度超过 2 年时需要横向滚动，后续应按周/月聚合

## 开发约定

- 源码用**显式 `.ts` / `.tsx` 扩展名**导入，配合 Node 原生类型擦除，无需构建即可运行
- `packages/core` 不许依赖 React 或 Electron；`apps/web` 不许 import `packages/server`
- 时间戳一律 ISO 8601 存 UTC，展示层转本地时区
- 任何 `git` 调用都走 `GitReader`，不许硬编码 `'git'`（桌面端要能切到内置 git）
