# 架构设计

## 1. 总览

```
┌───────────────────────────────────────────────────────────────────────┐
│  壳层（四选一，同一份前端）                                              │
│  Electron 桌面        浏览器（自托管）      PWA（移动）      Capacitor   │
└───────────────┬───────────────────────────────┬───────────────────────┘
                │  HTTP / SSE                   │ IPC（仅桌面原生能力）
┌───────────────▼───────────────────────────────▼───────────────────────┐
│  apps/web  ·  React + Vite                                             │
│  packages/ui  ·  设计系统：画布、卡片、图表、拖拽原语、连线渲染器        │
└───────────────┬───────────────────────────────────────────────────────┘
                │  REST（OpenAPI 契约，zod 校验）
┌───────────────▼───────────────────────────────────────────────────────┐
│  packages/server  ·  Fastify                                          │
│  路由 / 认证 / 权限守卫 / 规则引擎 / 索引任务队列 / SSE 推送            │
└───────────────┬───────────────────────────────────────────────────────┘
                │
┌───────────────▼───────────────────────────────────────────────────────┐
│  packages/core  ·  纯 TypeScript，无 UI 无框架                         │
│  ① GitReader（子进程封装，可注入 git 路径）                            │
│  ② Indexer（流式解析 → 增量写入）                                      │
│  ③ Layout（DAG 分层、树图、时间聚合）                                  │
│  ④ Rules（规则引擎与健康分）                                           │
│  ⑤ Store（StorageAdapter 抽象：SQLite / PostgreSQL）                  │
└───────────────┬───────────────────────────────────────────────────────┘
                │
     ┌──────────┴───────────┐
   git.exe（内置/系统）    SQLite 文件 / PostgreSQL
```

**分层的意义**：`core` 不认识 React 也不认识 Electron，所以索引引擎既能跑在桌面主进程里，也能跑在服务器容器里；同一个 DAG 布局函数既用于桌面 Canvas，也用于移动端手势画布。

---

## 2. 包结构

| 包 | 职责 | 依赖 |
| --- | --- | --- |
| `packages/core` | Git 读取、索引、布局算法、规则引擎、存储抽象 | 无框架依赖 |
| `packages/server` | HTTP API、认证、权限、任务队列 | core |
| `packages/ui` | 设计系统与可视化组件 | React、d3、echarts |
| `apps/web` | 页面组装、路由、状态管理 | server 契约、ui |
| `apps/desktop` | Electron 主进程 + preload + 打包配置 | server、core |
| `apps/mobile` | PWA 清单与 Capacitor 配置（后期） | web |

约束：**`ui` 不许 import `server`**，只能通过 `apps/web` 的 API 客户端。这条约束靠 ESLint 的 `no-restricted-imports` 强制，否则半年后会缠成一团。

---

## 3. 桌面壳选型：Electron（结论）

| 维度 | Electron | Tauri 2 | 本项目的权重 |
| --- | --- | --- | --- |
| 复用 TS 后端 | 主进程就是 Node，`core` 直接 import | 需 sidecar 进程或 Rust 重写 | **决定性**：core 要跑 git 子进程和 SQLite |
| 包体积 | ~120–180MB | ~8–15MB（另需 WebView2） | 中：便携版可接受，但要注意 |
| 运行时一致性 | 自带 Chromium，渲染行为确定 | 依赖系统 WebView2（Win10 需预装） | 高：图形密集页面不能有渲染差异 |
| 便携版 | electron-builder `portable` target 开箱可用 | 需自建打包 | 高：用户明确要便携 |
| 自动更新 | electron-updater 成熟 | 有，但生态较新 | 中 |
| 移动端 | 无 | 实验性支持 | 低：本项目移动端走 PWA |
| 原生模块 | better-sqlite3 需 electron-rebuild | 无 Node 原生模块问题 | 中：一次性配置成本 |

**选 Electron**。理由是"复用 TS 内核"这一项的收益，远大于体积损失；而移动端需求由 PWA 承接，不需要壳层的跨端能力。若未来体积成为硬约束，迁移成本可控——因为 `core`/`ui` 与壳层无关，只需重写 `apps/desktop` 的进程层。

**原生模块注意**：已放弃 `better-sqlite3`，改用 **Node 内置 `node:sqlite`**（P0 已验证可用）。收益是整条链路零原生模块：`pnpm install` 不需要编译，Electron 打包不需要 `electron-rebuild`，便携版也不带 `.node` 二进制。代价是它仍标注 experimental，因此 `packages/core/src/store/db.ts` 把 SQLite 访问收敛在 `Store` 一个类里，将来若要换回原生驱动，改动面只有这一个文件。

---

## 4. 内置 Git 运行时

零命令行产品不能假设用户装了 git。

**解析顺序**（可在设置里覆盖）：

1. 用户显式指定的 git 路径（设置页"高级"里，默认空）
2. 应用内置 git：`resources/git/bin/git.exe`（Windows 用 MinGit，裁剪版约 45MB 解压后 120MB）
3. 系统 `PATH` 里的 git（`where git`）

**实现要点**：

- `GitReader` 构造时接受 `gitPath`，所有调用走它，绝不硬编码 `'git'`；
- 启动时执行 `git --version` 做能力探测，把版本号存进 `repos` 元数据；
- 版本过低（< 2.25，缺 `--pretty` 的 ISO 严格格式支持）时提示"切换到内置 git"；
- 内置 git 走**按需解压**：安装包只含压缩包，首次使用时解压到数据目录，安装包体积少 60MB。

---

## 5. 进程模型与安全边界（桌面）

```
main（Node）                          renderer（Chromium）
├─ 窗口 / 托盘 / 单实例                ├─ React UI
├─ Fastify @ 127.0.0.1:<随机端口>  ←── HTTP（数据面）
│   └─ 一次性 token（每启动生成）
├─ core：索引、git 写操作              ├─ preload（contextBridge，白名单 API）
├─ SQLite                              └─ IPC（控制面）
└─ keytar：系统钥匙串
```

四条硬规则：

1. `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；
2. 本地 server 只绑 `127.0.0.1`，每次启动生成一次性 bearer token，注入到 renderer 的初始化上下文；外部页面无法访问；
3. 所有外链走 `shell.openExternal`，并在打开前显示完整域名（防钓鱼）；
4. 写操作（merge/push/reset）必须经 main 进程的**确认管道**：渲染层只发意图，main 计算影响预览、二次确认后才执行。

**为什么数据面走 HTTP 而不是全 IPC**：这样 `apps/web` 与桌面端用同一套 API 客户端，不需要为桌面写分支逻辑；只有原生能力（选目录、钥匙串、通知、更新）才走 IPC。

---

## 6. 存储适配层

```ts
interface StorageAdapter {
  repos: RepoStore; commits: CommitStore; refs: RefStore;
  fileChanges: FileChangeStore; ruleConfig: RuleConfigStore;
  viewMeta: ViewMetaStore;      // 拖拽后的布局、忽略状态
  tx<T>(fn: () => Promise<T>): Promise<T>;
}
```

- **桌面/便携**：`node:sqlite`（内置），单文件，`data/atlas.db`；WAL 模式，`synchronous=NORMAL`。
- **服务器**：PostgreSQL，同一套 Drizzle schema 分方言生成。
- **迁移**：drizzle-kit 生成 SQL，启动时自动迁移；迁移失败要能回滚到备份文件（桌面端自动备份 `atlas.db.bak`）。

`viewMeta` 单独建表很重要：拖拽布局、看板列状态、忽略的问题都存这里——它们是**用户视图数据**，与 git 数据物理隔离，重建索引不会丢。

---

## 7. 桌面 ↔ 服务器同步（可选）

用户可能在桌面看本地仓库、在手机看团队看板。设计原则：**服务器是只读投影的汇聚点，永远不反向改写 git**。

```
桌面客户端 --(登录后)--> 上传"索引快照"(压缩后的 commits/refs/规则结果)
                              ↓
                     服务器聚合多台客户端的数据 → 团队看板
```

- 快照带 `repo_remote_url + head_sha + generated_at`，服务器按这三元组去重；
- 冲突时以 `generated_at` 新者为准（快照是投影，无合并语义）；
- 敏感文件路径在上传前做**路径脱敏**（可选开关，安全团队会要求这个）。

---

## 8. 性能预算

| 指标 | 目标 | 手段 |
| --- | --- | --- |
| 索引吞吐 | 5 万 commit ≤ 60s | 流式解析、批量事务（每 500 提交一次）、`--no-merges` 与全量分两遍 |
| 首屏 | 桌面/Web ≤ 3s，移动 4G ≤ 4s | 预聚合表、首屏只请求汇总、路由级代码分割 |
| DAG 平移 | 5k 节点 ≥ 50fps | Canvas 2D（非 SVG）、视口裁剪、LOD（缩小时合并节点） |
| SQLite 查询 | p95 < 80ms | 覆盖索引、预聚合表、禁止 N+1 |
| 冷启动 | Electron ≤ 4s | 延迟加载索引器、`v8-compile-cache` |
| 安装包 | ≤ 180MB（git 按需解压后） | 裁剪 Chromium locales、asar 压缩 |

---

## 9. 关键依赖清单

| 用途 | 库 | 备注 |
| --- | --- | --- |
| Git 调用 | `execa`（自封装）| 不用 simple-git：需要精确控制参数与流式读取 |
| 状态/数据 | `zustand` + `@tanstack/react-query` | UI 态与服务器态分离（P0 尚未引入，先用 useState） |
| 拖拽 | `@dnd-kit/core` | 同时支持鼠标与触控，移动端同一套 |
| 分屏面板 | `dockview` | 可拖拽布局、序列化保存 |
| 图布局 | 自写 + `d3-scale`/`d3-shape` | 布局算法自控，绘制自控 |
| 统计图 | `echarts` | 热力图、树图开箱可用 |
| 曲线 | 自写 Catmull-Rom → 贝塞尔 | 需要控制曲率与交叠 |
| ORM | `drizzle-orm` | 双方言、类型安全 |
| 校验 | `zod` | API 契约与前端共用 |
| 认证 | `jose`（JWT）+ `@node-rs/argon2` | 原生模块但预编译齐全 |
| 凭据 | `keytar` | Win/macOS/Linux 统一接口 |
| 桌面 | `electron` + `electron-builder` + `electron-updater` | portable / nsis target |

---

## 10. 目录结构（目标态）

```
F:\GitAtlas\
├── PLAN.md
├── README.md
├── docs/                    # 本文档集
├── packages/
│   ├── core/                # git 读取、索引、布局、规则、存储抽象
│   ├── server/              # Fastify API
│   └── ui/                  # 设计系统与可视化组件
├── apps/
│   ├── web/                 # React 应用（Web / PWA 共用）
│   ├── desktop/             # Electron 主进程与打包
│   └── mobile/              # PWA manifest、Capacitor 配置（后期）
├── resources/
│   └── git/                 # 内置 MinGit（按需解压）
├── data/                    # 运行时数据（不入库）
└── docker-compose.yml
```
