# rssxcx

一个使用 GitHub Actions 定时抓取、GitHub Pages 静态发布的个人 RSS 源仓库。

所有最终 XML 统一放在 `feeds/<来源>/<订阅名>.xml`；抓取逻辑统一放在 `generators/`；解析后的文章缓存统一放在 `state/`。根目录不生成 RSS XML。

## 目录结构

```text
rssxcx/
├─ generators/                         # 抓取、正文解析和 RSS 生成器
│  ├─ xchuxing-official.js
│  └─ dongqiudi-team.js
├─ feeds/                              # GitHub Pages 直接发布的静态 XML
│  ├─ xchuxing/
│  │  └─ official.xml
│  └─ dongqiudi/
│     └─ team-50001756.xml
├─ state/                              # 已解析文章正文缓存，不对外订阅
│  └─ dongqiudi/
│     └─ team-50001756.json
├─ .github/workflows/update-feed.yml
├─ package.json
└─ README.md
```

## 现有订阅源

| 来源 | 生成文件 | GitHub Pages 订阅地址 |
| --- | --- | --- |
| 新出行官方频道 | `feeds/xchuxing/official.xml` | `https://virgooooox.github.io/rssxcx/feeds/xchuxing/official.xml` |
| 懂球帝：巴塞罗那 | `feeds/dongqiudi/team-50001756.xml` | `https://virgooooox.github.io/rssxcx/feeds/dongqiudi/team-50001756.xml` |

> 原根目录 `feed.xml` 已废弃。已有的新出行订阅请切换到 `feeds/xchuxing/official.xml`。

## 懂球帝全文图文 RSS

巴萨订阅源会先获取球队新闻列表，再只对没有正文缓存的最新文章抓取详情页。解析成功后，会将清洗后的正文 HTML 和正文图片按原文顺序写入 RSS 的 `description` 与 `content:encoded`；RSS 阅读器直接读取的是完整图文 XML，而不是“标题 + 原文跳转”。

图片保留懂球帝 CDN 的原始 URL，不下载到 GitHub 仓库。视频、嵌入媒体会回退为原文链接。详情页临时解析失败时，该文章仍会以“摘要 + 封面”的形式保留在 RSS 中；已有全文缓存不会因一次失败而被覆盖。

`state/dongqiudi/team-50001756.json` 用来避免 GitHub Actions 每 30 分钟重复抓取已解析过的文章。它不是订阅入口。

## 本地生成

```bash
npm ci
npm run generate:xchuxing:official
npm run generate:dongqiudi:barcelona
```

为兼容旧习惯，`npm run generate` 等同于生成新出行官方频道。

默认输出路径：

```text
feeds/xchuxing/official.xml
feeds/dongqiudi/team-50001756.xml
state/dongqiudi/team-50001756.json
```

## GitHub Actions 定时更新

工作流：`.github/workflows/update-feed.yml`

- 每 30 分钟运行一次；
- 新出行直接更新 XML；
- 懂球帝每轮先更新列表，并最多为 `FULL_CONTENT_LIMIT` 篇尚未缓存正文的文章抓取全文；
- 当前并发为 2，避免一次性抓取大量详情页；
- 懂球帝单次抓取失败时保留上一版 XML 与正文缓存，不影响新出行；
- 仅在 `feeds/` 或 `state/` 变化时提交；
- 修改 `generators/`、依赖或工作流后自动触发一次；生成的 XML 提交不会形成自触发循环。

## GitHub Pages

在仓库 **Settings → Pages** 中选择：

- **Source**：`Deploy from a branch`
- **Branch**：`main`
- **Folder**：`/ (root)`

Pages 会直接发布仓库内的 `feeds/` 目录。

## 可选 GitHub Actions Variables

进入 **Settings → Secrets and variables → Actions → Variables**：

| 变量 | 用途 |
| --- | --- |
| `XCHUXING_OFFICIAL_FEED_URL` | 新出行 RSS 自身地址，写入 atom:self |
| `XCHUXING_OFFICIAL_SITE_URL` | 新出行 RSS channel 链接；未设置则使用源站 URL |
| `DONGQIUDI_BARCELONA_FEED_URL` | 巴萨 RSS 自身地址，写入 atom:self |
| `FEED_URL` / `SITE_URL` | 旧版新出行变量，仍作为兼容兜底 |

这些变量不影响 GitHub Pages 提供 XML；不设置时订阅器仍可正常读取。

## 懂球帝球队生成器配置

脚本：`generators/dongqiudi-team.js`

| 变量 | 作用 | 默认值 |
| --- | --- | --- |
| `DONGQIUDI_TEAM_ID` | 球队 ID | `50001756` |
| `DONGQIUDI_TEAM_NAME` | 球队名称兜底值 | 页面元信息解析 |
| `DONGQIUDI_API_URL` | 新闻列表接口 | 懂球帝球队新闻接口 |
| `SOURCE_URL` | 球队主页 URL | 对应球队页 |
| `SITE_URL` | RSS channel 链接 | 对应球队页 |
| `FEED_URL` | RSS 自身地址 | 空 |
| `OUTPUT_PATH` | 最终 XML 输出路径 | `feeds/dongqiudi/team-<id>.xml` |
| `STATE_PATH` | 文章正文缓存文件 | `state/dongqiudi/team-<id>.json` |
| `FULL_CONTENT` | 是否抓取文章全文 | `true` |
| `FULL_CONTENT_LIMIT` | 每轮最多补抓的未缓存文章数 | `12` |
| `ARTICLE_CONCURRENCY` | 详情页抓取并发数 | `2` |
| `STATE_MAX_ARTICLES` | 缓存上限 | `200` |
| `MAX_ITEMS` | RSS 输出条目数 | `50` |
| `TIMEOUT_MS` | 单请求超时 | `15000` |
| `RETRIES` | 请求失败重试次数 | `2` |
| `RETRY_BASE_DELAY_MS` | 重试基础延迟 | `800` |
