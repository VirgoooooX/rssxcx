# rssxcx

一个使用 GitHub Actions 定时抓取、GitHub Pages 静态发布的个人 RSS 源仓库。

所有最终 XML 统一放在 `feeds/<来源>/<订阅名>.xml`；抓取逻辑统一放在 `generators/`。根目录不生成 RSS XML。

## 目录结构

```text
rssxcx/
├─ generators/                         # 抓取和 RSS 生成器
│  ├─ xchuxing-official.js
│  └─ dongqiudi-team.js
├─ feeds/                              # GitHub Pages 直接发布的静态 XML
│  ├─ xchuxing/
│  │  └─ official.xml
│  └─ dongqiudi/
│     └─ team-50001756.xml
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

## 懂球帝巴萨 RSS 最终策略

GitHub Actions 只负责从球队新闻列表获取并生成轻量 RSS 条目：标题、发布时间、分类、列表接口提供的摘要与封面，以及文章 ID。

每个 RSS item 的 `link` 都会由列表中的 WebApp 壳地址统一规范为：

```text
https://m.dongqiudi.com/article/<articleId>.html
```

GitHub 端**不请求文章详情接口、不抓文章页、不解析正文、不维护正文缓存**。后端服务器以这个移动端链接作为唯一详情入口，自行决定何时抓取、如何解析正文/图片及如何缓存；GitHub Actions 只维护稳定、低频、低开销的新闻索引。

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
```

## GitHub Actions 定时更新

工作流：`.github/workflows/update-feed.yml`

- 每 30 分钟运行一次；
- 只更新 `feeds/` 下的静态 XML；
- 懂球帝单次抓取失败时保留上一版 XML，不影响新出行；
- 仅在 XML 内容变化时提交；
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
| `MAX_ITEMS` | RSS 输出条目数 | `50` |
| `TIMEOUT_MS` | 单请求超时 | `15000` |
| `RETRIES` | 请求失败重试次数 | `2` |
| `RETRY_BASE_DELAY_MS` | 重试基础延迟 | `800` |
