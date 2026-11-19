# 账号、权限与交付形态

---

## 1. 三种运行模式

| 模式 | 登录 | 数据 | 适用 |
| --- | --- | --- | --- |
| **本地单机**（默认） | 免登录 | 本机 SQLite | 单人开发者、离线审计、安全隔离环境 |
| **桌面连服务器** | 账号登录 | 服务器 Postgres + 本机缓存 | 团队协作，桌面算力做索引 |
| **浏览器团队版** | 账号登录 | 服务器 Postgres | 远程同事、手机查看 |

设计原则：**免登录必须是真默认**。不能像很多工具那样"装完先逼你注册"，那会直接劝退休闲用户。

---

## 2. 账号体系

### 2.1 注册与登录

| 方式 | 说明 |
| --- | --- |
| 邮箱 + 密码 | 密码 Argon2id（memory 19MB, iterations 2）；邮箱需验证才能创建组织 |
| OAuth | GitHub / GitLab / Google；首次登录绑定邮箱，同名账号自动合并需邮件确认 |
| 邀请加入 | 组织 Owner 发邀请链接（一次性、7 天过期），对方点击后设密码或走 OAuth |

### 2.2 会话

- 访问令牌 JWT，有效期 **15 分钟**，`HS256` 签名（单机部署不引入密钥分发复杂度；多节点时改 RS256）；
- 刷新令牌 **30 天**，滑动续期，存 HttpOnly Cookie（Web）或系统钥匙串（桌面/移动）；
- 刷新令牌**轮转**：每次使用换新，旧的立即失效；检测到旧令牌被重放 → 撤销该设备全部会话；
- 「我的设备」页显示：设备名、最后活跃 IP（脱敏到 /24）、可单独登出；
- 2FA（TOTP）放 P6 之后，不阻塞主线。

### 2.3 凭据（重要区分）

两类凭据不许混：

1. **GitAtlas 账号**——用于登录本产品；
2. **Git 远端凭据**——GitHub/GitLab token 或 SSH key，用于实际 clone/push。

后者**永远加密存在服务端**（`git_credentials` 表，AES-256-GCM，密钥来自环境变量 `ATLAS_SECRET`，缺失则拒绝启动），桌面端存系统钥匙串。界面里只显示"已连接 · 最后使用 2 小时前"。

---

## 3. 权限模型

三级：**组织 → 空间 → 仓库**。空间（space）是团队的逻辑分组，例如"支付组"下的三个服务仓库。

### 3.1 角色矩阵

| 能力 | Owner | Admin | Member | Viewer |
| --- | --- | --- | --- | --- |
| 查看图表与问题 | ✓ | ✓ | ✓ | ✓ |
| 刷新索引 | ✓ | ✓ | ✓ | ✗ |
| 改规则阈值 | ✓ | ✓ | ✓ | ✗ |
| 执行写操作（合并/推送） | ✓ | ✓ | 可配置（默认 ✓） | ✗ |
| 创建/撤销分享链接 | ✓ | ✓ | ✗ | ✗ |
| 管理成员与角色 | ✓ | ✓ | ✗ | ✗ |
| 配置服务器与备份 | ✓ | ✗ | ✗ | ✗ |
| 查看审计日志 | ✓ | ✓ | ✗ | ✗ |
| 删除组织 | ✓ | ✗ | ✗ | ✗ |

实现要点：权限判断放在 server 的**守卫层**（`can(user, 'repo:write', repo)`），不在前端隐藏按钮了事；所有查询强制带 `org_id` 作用域，越权用例进集成测试。

---

## 4. 分享链接（"链接也要美化"的落地）

面向"发给远程同事看一眼"的场景，不需要对方有账号。

```
https://atlas.example.com/s/7fK2mQ-aBc9
```

| 特性 | 说明 |
| --- | --- |
| 权限 | 只读，仅视图渲染，无 API 写入口 |
| 范围 | 可选：整个空间 / 单仓库 / 某个视图快照 |
| 过期 | 1 天 / 7 天 / 30 天 / 永久（永久需 Owner 二次确认） |
| 撤销 | 立即失效，页面显示"链接已被撤销" |
| 访问日志 | 时间、IP 段、设备，保留 30 天 |
| 水印 | 页面右下角半透明「由 {组织名} 分享 · 只读」，可用 CSS 伪元素但不能被选择性隐藏 |
| 防爬 | 分享页 `noindex`，禁止被搜索引擎收录 |
| 敏感遮蔽 | 若仓库命中安全类问题（X1/X2），分享页默认隐藏代码片段，仅显示"存在疑似密钥（已遮蔽）" |

UI 上，分享链接渲染成药丸标签：

```
🔗 atlas.example.com/s/7fK2mQ  [只读] [7 天后过期]  ⎘ 复制  ⓘ 详情
```

---

## 5. 四种交付形态

### 5.1 便携版（Portable）

- 单个 `.exe`，运行后自动解压到临时目录，退出清理；数据目录固定在 **exe 同目录 `data/`**（U 盘可带走）；
- **不写注册表、不加开机自启、不创建开始菜单项**；
- 单实例锁按数据目录区分，因此**便携版与安装版可同时运行**（互不干扰，端口各自随机）；
- 更新：手动替换 exe；启动时检测新版本给出提示条（不自动更新，避免破坏"便携"预期）。

### 5.2 安装版（NSIS，per-user）

- 安装到 `%LOCALAPPDATA%\Programs\GitAtlas`，**免管理员权限**；
- 数据在 `%APPDATA%\GitAtlas`；
- 可选项：开机自启（默认关）、关联右键菜单"用 GitAtlas 打开此仓库"（默认开）、协议注册 `gitatlas://`（用于 OAuth 回跳与分享链接唤起）；
- 自动更新：`electron-updater` + 增量差分包，静默下载 + 提示重启；
- **代码签名**：无签名会触发 SmartScreen 警告。有证书则签名（推荐 EV 证书）；无证书时在下载页明确说明，并提供 SHA-256 校验值。这一点要写进发布文档，别让用户以为是恶意软件。

### 5.3 服务器版（Docker Compose）

```yaml
services:
  app:
    image: gitatlas/app:latest
    ports: ["3000:3000"]
    environment:
      ATLAS_SECRET: ${ATLAS_SECRET}          # 必填，缺失拒绝启动
      ATLAS_DB_URL: postgres://atlas:${DB_PASSWORD}@db:5432/atlas
      ATLAS_PUBLIC_URL: https://atlas.example.com
      ATLAS_REGISTRATION: invite-only        # open | invite-only | closed
    volumes: ["atlas-data:/data"]
    depends_on: [db]
    healthcheck: { test: ["CMD", "curl", "-f", "http://localhost:3000/health"], interval: 30s }

  db:
    image: postgres:16-alpine
    environment: { POSTGRES_DB: atlas, POSTGRES_USER: atlas, POSTGRES_PASSWORD: ${DB_PASSWORD} }
    volumes: ["atlas-pg:/var/lib/postgresql/data"]

  # 可选：反代 + 自动 HTTPS
  caddy:
    image: caddy:2-alpine
    ports: ["80:80", "443:443"]
    volumes: ["./Caddyfile:/etc/caddy/Caddyfile", "caddy-data:/data"]

volumes: { atlas-data: {}, atlas-pg: {}, caddy-data: {} }
```

**首次启动向导**（浏览器里完成，不编辑 YAML）：创建管理员账号 → 建组织 → 邀请成员 → 连第一个仓库（粘贴 URL 或选服务器本地路径）。

**备份**：内置定时任务 `pg_dump` 到 `/data/backups/`，保留 7 份；页面「系统」页显示最近备份时间与一键下载。桌面端每次启动前自动备份 `atlas.db`。

### 5.4 移动端

**PWA 优先**（上线快、零审核）：

- `manifest.json`：名称、图标（含 maskable）、`display: standalone`、主题色；
- Service Worker 策略：API GET 用 `stale-while-revalidate`（离线可看上次快照），写请求**不缓存**；
- iOS 限制需明说：安装要手动"添加到主屏幕"；推送需 iOS 16.4+ 且必须已安装；本地存储可能被系统回收（因此离线缓存要能被重建）；
- 登录态：刷新令牌存 WebCrypto 加密的 IndexedDB（`httpOnly` cookie 在 PWA 独立窗口下更稳，优先用它）。

**Capacitor 壳**放 P6 之后：需要应用商店分发、需要推送/生物识别解锁时再上，届时复用同一份 web 产物。

---

## 6. 部署安全清单

上线前逐项打勾：

- [ ] 强制 HTTPS（Caddy 自动证书；桌面端本地 server 仅绑 127.0.0.1 无需 TLS）
- [ ] `ATLAS_SECRET` 未设置时拒绝启动，并打印生成命令
- [ ] 登录/注册接口限流（IP + 账号双维度，5 次/分）
- [ ] CSP：`default-src 'self'`，无 `unsafe-eval`；外链图片走代理或禁止
- [ ] 所有写操作留审计日志（谁、何时、什么仓库、什么操作、结果）
- [ ] 分享链接与 OAuth 回调校验 `state`，防 CSRF
- [ ] 数据库连接强制 TLS（非内网时）
- [ ] 依赖漏洞扫描进 CI（`pnpm audit` + Dependabot）
- [ ] 备份可恢复性每季度演练一次（备份没用过等于没有）
- [ ] 错误响应不泄漏内部路径与 SQL

---

## 7. 升级与迁移

| 场景 | 策略 |
| --- | --- |
| 桌面数据库 schema 变更 | 启动迁移；失败则回滚 `.bak` 并提示"请先用旧版本导出" |
| 服务器 schema 变更 | 迁移前自动 `pg_dump`；大版本升级要求显式 `--migrate` 参数 |
| 便携版换机 | 整个目录拷贝（含 `data/`）即可，路径无关 |
| 团队版迁云 | 导出 `pg_dump` + `ATLAS_SECRET` 保持旧值（否则凭据需重新录入） |

`ATLAS_SECRET` 变更会让所有 Git 远端凭据不可解密——这条必须写进运维文档，是常见的翻车点。
