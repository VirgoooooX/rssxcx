# xchuxing official RSS

生成并发布 `https://www.xchuxing.com/official` 的 RSS（`feed.xml`）。

## 本地运行

```bash
npm ci
npm run generate
```

默认输出到项目根目录 `feed.xml`。

## GitHub Actions 定时更新

仓库包含工作流：`.github/workflows/update-feed.yml`

它会：
- 每 30 分钟抓取一次并生成 `feed.xml`
- 仅在 `feed.xml` 内容变化时提交并推送

### 推荐发布方式：GitHub Pages

1. 在 GitHub 仓库设置里启用 Pages（Build and deployment）
   - Source 选择 `Deploy from a branch`
   - Branch 选择 `main`（或你的默认分支），Folder 选择 `/ (root)`
2. 你将得到一个 Pages 地址，例如：
   - `https://<username>.github.io/<repo>/feed.xml`
3. 在仓库 Settings → Secrets and variables → Actions → Variables 里添加：
   - `FEED_URL`：填你的 RSS 地址（上面的 Pages feed.xml 链接）
   - `SITE_URL`（可选）：不填就默认使用源站 `https://www.xchuxing.com/official`

之后你的订阅地址就是 GitHub Pages 上的 `feed.xml`。

## 可用环境变量

脚本：`generate_rss.js`

- `SOURCE_URL`：抓取页面，默认 `https://www.xchuxing.com/official`
- `FEED_URL`：RSS 自身地址（用于 atom:self / 标识）
- `SITE_URL`：频道主页地址
- `OUTPUT_PATH`：输出文件路径（默认 `./feed.xml`）
- `MAX_ITEMS`：最大条目数（默认 50）
- `TIMEOUT_MS`：抓取超时（默认 15000）
- `RETRIES`：失败重试次数（默认 2）
- `RETRY_BASE_DELAY_MS`：重试基础延迟（默认 800）
