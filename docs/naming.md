# 命名

## 定名

**GitAtlas**，中文名 **Git 协作图谱**。

理由：
- `Atlas`（地图集）直接对应"把分散的仓库状态收拢成一张可导航的图"，比 `Git Viewer` / `Git Dashboard` 这类描述式名字更有记忆点
- 拼写短、全小写无连字符，域名和包名都干净（`git-atlas` 作 npm 包名备选）
- 不与现有产品撞名：GitLens、GitKraken、Gource、TortoiseGit 均已占用

## 备选（若发现 GitAtlas 已被占用）

| 名字 | 调性 | 备注 |
| --- | --- | --- |
| RepoPulse | 轻快，强调"健康度监测" | 偏监测而非地图 |
| Branchlight | 有画面感，隐喻"照亮分支" | 略文艺 |
| GitCartograph | 精确但太长 | 只适合做副标题 |
| 拓谱 / Topo | 中文单字，好念 | 适合作为产品中文短名 |

## 术语约定

为避免文档和代码里各叫各的，统一如下：

| 概念 | 用词 | 不用 |
| --- | --- | --- |
| 被索引的仓库 | repo | project, workspace |
| 索引过程 | 采集 / collect | sync, import |
| 分支僵化状态 | stale | dead, abandoned |
| 文件热区 | hotspot | churn（churn 只用在代码变动量指标上） |
| 协作预警 | alert | warning, issue |

## 界面文案语气

中文优先，动词开头，不用感叹号。示例：

- ✅「31 天未合并，落后 main 47 个提交」
- ❌「警告！这条分支可能已经很危险了！」
