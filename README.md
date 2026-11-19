# GitAtlas（Git 协作图谱）

把仓库里"只有敲命令才看得见"的一切——状态、结构、问题——变成一张能拖、能点、能分享的图。

**三个卖点**：全景可视（所有问题有位置）· 零命令行（全程不碰终端）· 多端可达（桌面便携/安装 · 网页自托管 · 手机主屏）。

- **交付形态**：便携 exe / 安装包 / Docker 自托管 / PWA
- **技术栈**：TypeScript 全栈 —— `core`（Git 分析内核）+ Fastify + React/Vite + SQLite/PostgreSQL + Electron
- **不做**：自建 git 服务器、CI/CD、替代 GitHub 的 PR 流程

## 文档

| 文件 | 内容 |
| --- | --- |
| [PLAN.md](./PLAN.md) | 总方案：三支柱、边界、六屏视图、P0–P7 分期（约 45–55 人日） |
| [docs/problem-rules.md](./docs/problem-rules.md) | **问题全景**：28 条检测规则、健康分算法、阈值图形化 |
| [docs/architecture.md](./docs/architecture.md) | 分层架构、Electron 选型对比、内置 git、进程安全、性能预算 |
| [docs/ux-flows.md](./docs/ux-flows.md) | **零命令行**操作映射、拖拽规格、连线视觉规格、状态设计、移动端手势 |
| [docs/accounts-deploy.md](./docs/accounts-deploy.md) | 账号与权限矩阵、分享链接、四种交付形态、部署安全清单 |
| [docs/data-model.md](./docs/data-model.md) | 表结构、Git 抽取命令、增量刷新、身份归一化 |
| [docs/naming.md](./docs/naming.md) | 命名由来、术语约定、文案语气 |

## 阅读顺序建议

先看 PLAN.md 的「三支柱」和「分期计划」；若关心"到底能看到什么问题"，直接翻 problem-rules.md；若关心"零命令行怎么实现"，翻 ux-flows.md 的操作映射表。

## 状态

计划定稿 v2（2026-11-19）。代码尚未初始化——等确认 PLAN.md 第 11 节的四个待决项后从 P0 开始。
