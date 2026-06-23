# rssxcx

一个使用 GitHub Actions 定时抓取、GitHub Pages 静态发布的个人 RSS 源仓库。

所有生成结果统一放在 `feeds/<来源>/<订阅名>.xml`；所有抓取逻辑统一放在 `generators/`。根目录不再生成 RSS XML。

## 目录结构

```text
rssxcx/
├─ generators/                         # 抓取与 RSS 生成器
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
- 仅在 `feeds/` 下的 XML 确实变化时提交；
- 懂球帝单次抓取失败时保留上一版 XML，不影响新出行；
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

## 懂球帝球队生成器

脚本：`generators/dongqiudi-team.js`

- `DONGQIUDI_TEAM_ID`：球队 ID，默认 `50001756`
- `DONGQIUDI_TEAM_NAME`：球队名称兜底值
- `DONGQIUDI_API_URL`：新闻列表接口
- `SOURCE_URL`：球队主页 URL
- `SITE_URL`：RSS channel 链接
- `FEED_URL`：RSS 自身地址
- `OUTPUT_PATH`：输出 XML 路径
- `MAX_ITEMS`：最大条目数，默认 `50`
- `TIMEOUT_MS`：请求超时，默认 `15000`
- `RETRIES`：失败重试次数，默认 `2`
- `RETRY_BASE_DELAY_MS`：重试基础延迟，默认 `800`

它只生成列表型 RSS：标题、摘要、时间、封面、分类和懂球帝原文链接；不会依赖 RSSHub 已失效的旧 Nuxt 页面数据，也不会逐条抓全文。
