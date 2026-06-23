# xchuxing official RSS

静态生成并发布 RSS 文件，当前包含：

- 新出行官方频道：`https://www.xchuxing.com/official` → `feed.xml`
- 懂球帝巴塞罗那球队新闻：`https://www.dongqiudi.com/team/50001756` → `feeds/dongqiudi/team-50001756.xml`

## 本地运行

```bash
npm ci
npm run generate
npm run generate:dongqiudi:barcelona
```

默认输出：

- 新出行：项目根目录 `feed.xml`
- 懂球帝：`feeds/dongqiudi/team-50001756.xml`

懂球帝生成器默认只生成列表型 RSS：标题、摘要、发布时间、封面、分类和原文链接；不再依赖 RSSHub 中已失效的旧 Nuxt 页面数据，也不抓取全文。

## GitHub Actions 定时更新

仓库包含工作流：`.github/workflows/update-feed.yml`

它会：

- 每 30 分钟抓取一次并生成 RSS
- 懂球帝单次抓取失败时保留上次成功生成的 XML，不影响新出行 feed
- 仅在 RSS 文件内容变化时提交并推送
- 生成器代码或工作流更新时自动触发一次，之后由定时任务继续更新

## 推荐发布方式：GitHub Pages

1. 在 GitHub 仓库设置里启用 Pages（Build and deployment）
   - Source 选择 `Deploy from a branch`
   - Branch 选择 `main`，Folder 选择 `/ (root)`
2. 默认 Pages 地址通常为：
   - `https://<username>.github.io/<repo>/feed.xml`
   - `https://<username>.github.io/<repo>/feeds/dongqiudi/team-50001756.xml`
3. 可选：在仓库 **Settings** → **Secrets and variables** → **Actions** → **Variables** 中配置：
   - `FEED_URL`：新出行 feed 的公开地址
   - `SITE_URL`：新出行频道主页地址
   - `DONGQIUDI_BARCELONA_FEED_URL`：懂球帝巴萨 feed 的公开地址

`FEED_URL` 类变量只用于 RSS 的 atom:self 标识；未设置不影响订阅器读取 XML。

## 懂球帝生成器可用环境变量

脚本：`generate_dongqiudi_team.js`

- `DONGQIUDI_TEAM_ID`：球队 ID，默认 `50001756`
- `DONGQIUDI_TEAM_NAME`：球队名兜底值，默认由当前球队页面的 Open Graph 元信息解析
- `DONGQIUDI_API_URL`：新闻列表 API，默认 `https://api.dongqiudi.com/v3/archive/app/channel/feeds`
- `SOURCE_URL`：球队主页 URL
- `SITE_URL`：RSS channel 链接
- `FEED_URL`：RSS 自身地址
- `OUTPUT_PATH`：输出文件路径
- `MAX_ITEMS`：最大条目数，默认 `50`
- `TIMEOUT_MS`：请求超时，默认 `15000`
- `RETRIES`：失败重试次数，默认 `2`
- `RETRY_BASE_DELAY_MS`：重试基础延迟，默认 `800`
