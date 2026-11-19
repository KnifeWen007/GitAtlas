# 数据模型（collector → SQLite）

设计原则：**索引阶段把能算的都算完，前端只做读取和渲染。** 前端请求时绝不触发全历史扫描。

---

## repos

被跟踪的仓库。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PK | |
| name | TEXT | 展示名，如 `payment-service` |
| path | TEXT | 本地路径或 bare 镜像路径 |
| remote_url | TEXT | 远端地址（可空） |
| default_branch | TEXT | 如 `main` |
| head_sha | TEXT | 上次索引到的 HEAD，用于判断是否需要刷新 |
| last_indexed_at | TEXT | ISO8601 |
| commit_count | INTEGER | 缓存值，避免 count(*) |

---

## commits

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| sha | TEXT PK | 40 位 |
| repo_id | INTEGER | → repos.id |
| author_name | TEXT | 原始 author name |
| author_email | TEXT | 原始 author email |
| author_id | INTEGER | → authors.id（归一化后） |
| authored_at | TEXT | ISO8601，**统一转 UTC 存储**，展示时转本地时区 |
| committed_at | TEXT | 同上；rebase 后与 authored_at 可能差异很大 |
| subject | TEXT | 首行标题 |
| is_merge | INTEGER | 0/1。`git log --no-merges` 能省一半数据，但拓扑图需要 merge 节点，所以保留并打标 |
| parent_count | INTEGER | 0（根）/1/2+ |
| files_changed | INTEGER | 预计算 |
| insertions | INTEGER | 预计算 |
| deletions | INTEGER | 预计算 |

**索引 SQL 形态**（一条命令拿全，避免 N 次调用）：

```bash
git log --all --numstat --date=iso-strict \
  --pretty=format:'%x01%H%x02%an%x02%ae%x02%aI%x02%cI%x02%P%x02%s'
```

用 `\x01` / `\x02` 作分隔符，避开 commit message 里可能出现的普通字符。

---

## file_changes

commit × 文件粒度的增量。这是最占空间的表，也是热区图的数据源。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| commit_sha | TEXT | → commits.sha |
| path | TEXT | 相对仓库根 |
| insertions | INTEGER | `-`（二进制文件）记为 NULL |
| deletions | INTEGER | 同上 |
| change_type | TEXT | A/M/D/R（重命名需 `--find-renames`） |

索引：`(path, change_type)`、`(commit_sha)`。热区聚合走 `GROUP BY path`。

---

## refs

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| repo_id | INTEGER | |
| name | TEXT | `refs/heads/feature/x` |
| short_name | TEXT | `feature/x` |
| kind | TEXT | branch / tag |
| target_sha | TEXT | |
| is_remote | INTEGER | 远端跟踪分支 |
| last_commit_at | TEXT | 分支头提交时间 |
| first_seen_at | TEXT | 首次被索引到的时间（算"年龄"） |
| ahead_of_default | INTEGER | 预计算：领先 default 多少 commit |
| behind_default | INTEGER | 预计算 |
| merged_into_default | INTEGER | 0/1 |

**ahead/behind 预计算**是关键优化：`git rev-list --count main..branch` 在拓扑图悬停时现算会卡，索引时算好用 `refs` 表带出来。

---

## authors

同一人多邮箱是这类工具的头号数据质量问题，必须显式建模。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PK | |
| canonical_name | TEXT | 归一后的显示名 |
| canonical_email | TEXT | |
| aliases | TEXT(JSON) | `[{name, email}]` 原始身份列表 |

归一策略，按顺序：
1. 跑 `git shortlog -sne` 拿到原始身份清单
2. 应用仓库 `.mailmap`（`git log --use-mailmap` 自动生效）
3. 剩余未合并的交给人工：界面提供"这两人是同一个人"的合并按钮，写回 `author_merges` 表

```sql
CREATE TABLE author_merges (
  from_email TEXT PRIMARY KEY,
  to_author_id INTEGER
);
```

---

## 预聚合表

前端请求直接读这些，代价是索引时多算一点。

| 表 | 用途 |
| --- | --- |
| `daily_stats` | `(repo_id, date, commits, insertions, deletions)` — 时间轴热力图 |
| `hourly_stats` | `(repo_id, weekday, hour, commits)` — 作息分布 |
| `file_hotspots` | `(repo_id, path, changes_30d, changes_all, authors_30d)` — 树图 |
| `author_modules` | `(author_id, path_prefix, commits)` — 模块归属推断 |
| `alerts` | 预警规则输出，带 `rule_key` 和 `severity` |

---

## 增量刷新流程

```
1. 读 repos.head_sha
2. git for-each-ref --format='%(refname) %(objectname)'
3. 若有 ref 指向新 sha：
   a. git log <old_head>..<new_head> --numstat  → 只处理新增部分
   b. 重算受影响分支的 ahead/behind
   c. 更新 daily_stats / file_hotspots 的增量
   d. 重跑预警规则（只针对受影响的分支/文件）
4. 更新 head_sha 与 last_indexed_at
```

强制全量重建入口：`pnpm collect --full`，用于 schema 变更后。
