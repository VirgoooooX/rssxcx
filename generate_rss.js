const axios = require('axios');
const cheerio = require('cheerio');
const RSS = require('rss');
const fs = require('fs');
const path = require('path');

const SOURCE_URL = process.env.SOURCE_URL || 'https://www.xchuxing.com/official';
const FEED_URL = process.env.FEED_URL || '';
const SITE_URL = process.env.SITE_URL || SOURCE_URL;
const OUTPUT_PATH = process.env.OUTPUT_PATH || path.join(__dirname, 'feed.xml');
const MAX_ITEMS = Number.parseInt(process.env.MAX_ITEMS || '50', 10);
const TIMEOUT_MS = Number.parseInt(process.env.TIMEOUT_MS || '15000', 10);
const RETRIES = Number.parseInt(process.env.RETRIES || '2', 10);
const RETRY_BASE_DELAY_MS = Number.parseInt(process.env.RETRY_BASE_DELAY_MS || '800', 10);
const USER_AGENT =
    process.env.USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url) {
    let lastErr = null;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
        try {
            const res = await axios.get(url, {
                timeout: TIMEOUT_MS,
                headers: {
                    'User-Agent': USER_AGENT,
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                },
                validateStatus: (status) => status >= 200 && status < 400,
            });
            return res.data;
        } catch (err) {
            lastErr = err;
            if (attempt >= RETRIES) break;
            const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
            await sleep(delay);
        }
    }
    throw lastErr;
}

function writeFileAtomic(filePath, content) {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const tmpPath = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmpPath, content);
    fs.renameSync(tmpPath, filePath);
}

function normalizeImageUrl(input) {
    if (!input) return '';
    if (typeof input !== 'string') return '';
    const value = input.trim();
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) return value;
    const cleaned = value.replace(/^\//, '');
    if (cleaned.startsWith('article/')) {
        return `https://s1.xchuxing.com/xchuxing/${cleaned}`;
    }
    if (cleaned.startsWith('xchuxing/')) {
        return `https://s1.xchuxing.com/${cleaned}`;
    }
    return `https://s1.xchuxing.com/${cleaned}`;
}

function toDateFromArticle(article) {
    const tsRaw = article && (article.created_at ?? article.updated_at);
    const ts = Number(tsRaw);
    if (!Number.isNaN(ts)) {
        return new Date(ts > 10000000000 ? ts : ts * 1000);
    }
    return new Date();
}

function buildItemUrl(article) {
    const primaryId = article && (article.object_id ?? article.id);
    if (!primaryId) return SOURCE_URL;

    const type = Number(article && article.type);
    if (type === 12) return `https://www.xchuxing.com/number-power/${primaryId}`;
    if (type === 13) return `https://www.xchuxing.com/short-news/${primaryId}`;
    return `https://www.xchuxing.com/article/${primaryId}`;
}

function shouldIncludeArticle(article, nonBriefUrls) {
    if (!article) return false;

    const type = Number(article.type);
    if (type !== 13) return true;

    const shortContent = article.short_content;
    if (!Array.isArray(shortContent) || shortContent.length === 0) return true;

    const urls = shortContent
        .map((entry) => (entry && typeof entry.url === 'string' ? entry.url.trim() : ''))
        .filter(Boolean);

    if (urls.length === 0) return true;
    return !urls.every((u) => nonBriefUrls.has(u));
}

function extractDescription(article) {
    const summary = article && article.summary;
    if (typeof summary === 'string' && summary.trim()) return summary.trim();

    const short = article && article.short_content;
    if (typeof short === 'string' && short.trim()) return short.trim();

    if (Array.isArray(short)) {
        const lines = [];
        for (const entry of short) {
            if (!entry || typeof entry !== 'object') continue;
            const t = typeof entry.title === 'string' ? entry.title.trim() : '';
            const c = typeof entry.content === 'string' ? entry.content.trim() : '';
            const line = t && c ? `${t}：${c}` : c || t;
            if (line) lines.push(line);
            if (lines.length >= 5) break;
        }
        if (lines.length) return lines.join('<br>');
    }

    return '';
}

async function generateRSS() {
    try {
        const html = await fetchWithRetry(SOURCE_URL);
        const $ = cheerio.load(html);
        const scriptContent = $('#__NUXT_DATA__').html();

        if (!scriptContent) {
            console.error('Could not find Nuxt data script');
            return;
        }

        const rawData = JSON.parse(scriptContent);
        
        const unflatten = (index, cache = new Map()) => {
            if (cache.has(index)) return cache.get(index);
            if (index < 0 || index >= rawData.length) return null;
            const val = rawData[index];
            if (val === null) return null;
            
            if (typeof val === 'object') {
                if (Array.isArray(val)) {
                    const arr = [];
                    cache.set(index, arr);
                    val.forEach(i => arr.push(unflatten(i, cache)));
                    return arr;
                } else {
                    const obj = {};
                    cache.set(index, obj);
                    for (const k in val) {
                        obj[k] = unflatten(val[k], cache);
                    }
                    return obj;
                }
            }
            return val;
        };

        let listContainerIdx = -1;
        for (let i = 0; i < rawData.length; i++) {
            const item = rawData[i];
            if (item && typeof item === 'object' && !Array.isArray(item) && item.hasOwnProperty('list') && item.hasOwnProperty('category')) {
                listContainerIdx = i;
                break;
            }
        }

        if (listContainerIdx === -1) {
             for (let i = 0; i < rawData.length; i++) {
                const item = rawData[i];
                if (item && typeof item === 'object' && !Array.isArray(item) && item.hasOwnProperty('list')) {
                    listContainerIdx = i;
                    break;
                }
            }
        }

        if (listContainerIdx === -1) {
            console.error('Failed to locate content.');
            return;
        }

        const contentData = unflatten(listContainerIdx);
        
        if (!contentData || !contentData.list || !Array.isArray(contentData.list)) {
            console.error('Content data structure is invalid');
            return;
        }

        const articles = contentData.list;
        const sorted = [...articles]
            .filter(Boolean)
            .sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0))
            .slice(0, Number.isFinite(MAX_ITEMS) ? Math.max(1, MAX_ITEMS) : 50);

        const itemsWithUrl = sorted.map((article) => ({
            article,
            url: buildItemUrl(article),
        }));

        const nonBriefUrls = new Set(
            itemsWithUrl
                .filter(({ article }) => Number(article && article.type) !== 13)
                .map(({ url }) => url),
        );

        const filtered = itemsWithUrl.filter(({ article }) => shouldIncludeArticle(article, nonBriefUrls));

        const feed = new RSS({
            title: '新出行 - 官方频道',
            description: '新出行官方频道最新资讯',
            feed_url: FEED_URL || undefined,
            site_url: SITE_URL,
            language: 'zh-CN',
            ttl: 60,
        });

        filtered.forEach(({ article, url }) => {
            const primaryId = article.object_id ?? article.id;
            const type = Number(article.type) || 0;
            const guid = primaryId ? `xchuxing:${type}:${primaryId}` : url;
            const title = typeof article.title === 'string' ? article.title : String(article.title || '');
            const description = extractDescription(article);
            const imageUrl = normalizeImageUrl(article.cover_path || article.cover);
            const date = toDateFromArticle(article);

            feed.item({
                title: title,
                description: description + (imageUrl ? `<br><img src="${imageUrl}">` : ''),
                url: url,
                date: date,
                guid: guid,
            });
        });

        const xml = feed.xml({ indent: true });
        writeFileAtomic(OUTPUT_PATH, xml);
        console.log(`RSS feed generated successfully at ${OUTPUT_PATH}`);

    } catch (error) {
        console.error('Error:', error && error.message ? error.message : error);
        try {
            if (fs.existsSync(OUTPUT_PATH)) {
                console.error(`Keeping existing RSS file: ${OUTPUT_PATH}`);
            }
        } catch (_) {
        }
        process.exitCode = 1;
    }
}

generateRSS();
