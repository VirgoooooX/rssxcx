const axios = require('axios');
const cheerio = require('cheerio');
const RSS = require('rss');
const fs = require('fs');
const path = require('path');

const TEAM_ID = String(process.env.DONGQIUDI_TEAM_ID || '50001756').trim();
const TEAM_NAME = String(process.env.DONGQIUDI_TEAM_NAME || '').trim();
const TEAM_URL = process.env.SOURCE_URL || `https://www.dongqiudi.com/team/${TEAM_ID}`;
const API_URL = process.env.DONGQIUDI_API_URL || 'https://api.dongqiudi.com/v3/archive/app/channel/feeds';
const FEED_URL = process.env.FEED_URL || '';
const SITE_URL = process.env.SITE_URL || TEAM_URL;
const OUTPUT_PATH = process.env.OUTPUT_PATH || path.join(__dirname, '..', 'feeds', 'dongqiudi', `team-${TEAM_ID}.xml`);
const MAX_ITEMS = Number.parseInt(process.env.MAX_ITEMS || '50', 10);
const TIMEOUT_MS = Number.parseInt(process.env.TIMEOUT_MS || '15000', 10);
const RETRIES = Number.parseInt(process.env.RETRIES || '2', 10);
const RETRY_BASE_DELAY_MS = Number.parseInt(process.env.RETRY_BASE_DELAY_MS || '800', 10);
const USER_AGENT =
    process.env.USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

if (!TEAM_ID) throw new Error('DONGQIUDI_TEAM_ID must not be empty');

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeFileAtomic(filePath, content) {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, filePath);
}

async function getWithRetry(url, options = {}) {
    let lastError = null;

    for (let attempt = 0; attempt <= RETRIES; attempt++) {
        try {
            return await axios.get(url, {
                timeout: TIMEOUT_MS,
                maxRedirects: 5,
                responseType: options.responseType,
                params: options.params,
                headers: {
                    Accept: 'application/json, text/plain, */*',
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                    'User-Agent': USER_AGENT,
                    Referer: TEAM_URL,
                    ...options.headers,
                },
                validateStatus: (status) => status >= 200 && status < 400,
            });
        } catch (error) {
            lastError = error;
            if (attempt >= RETRIES) break;
            await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
        }
    }

    throw lastError;
}

function getMetaContent($, selector) {
    return $(selector).attr('content')?.trim() || '';
}

function cleanTeamName(value) {
    if (!value) return '';
    return value
        .replace(/\s*[|｜_-]\s*懂球帝.*$/i, '')
        .replace(/\s*[-_|｜]\s*足球比分.*$/i, '')
        .replace(/^懂球帝\s*[-_|｜]\s*/i, '')
        .trim();
}

function normalizeUrl(value, baseUrl = 'https://www.dongqiudi.com') {
    if (typeof value !== 'string') return '';
    const input = value.trim();
    if (!input) return '';
    if (input.startsWith('//')) return `https:${input}`;

    try {
        return new URL(input, baseUrl).href;
    } catch (_) {
        return '';
    }
}

async function getTeamMeta() {
    try {
        const { data: html } = await getWithRetry(TEAM_URL, {
            responseType: 'text',
            headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
        });
        const $ = cheerio.load(html);
        const rawName =
            getMetaContent($, 'meta[property="og:title"]') ||
            getMetaContent($, 'meta[name="twitter:title"]') ||
            $('title').text().trim();
        const image =
            normalizeUrl(getMetaContent($, 'meta[property="og:image"]')) ||
            normalizeUrl(getMetaContent($, 'meta[name="twitter:image"]'));

        return { name: cleanTeamName(rawName) || TEAM_NAME || `懂球帝球队 ${TEAM_ID}`, image };
    } catch (error) {
        console.warn(`Could not read team metadata: ${error.message}`);
        return { name: TEAM_NAME || `懂球帝球队 ${TEAM_ID}`, image: '' };
    }
}

function getArticleList(payload) {
    const articles = [payload?.data?.articles, payload?.data?.data?.articles, payload?.articles].find(Array.isArray);
    if (!articles) throw new Error('Unexpected Dongqiudi API payload: articles array not found');
    return articles;
}

function getArticleId(article) {
    const id = article?.id ?? article?.article_id ?? article?.object_id;
    return id === undefined || id === null || id === '' ? '' : String(id);
}

function getArticleUrl(article, articleId) {
    const candidates = [article?.share_url, article?.url, article?.web_url, article?.link];

    for (const candidate of candidates) {
        if (typeof candidate !== 'string' || !candidate.trim()) continue;
        const deepLink = candidate.trim().match(/^dongqiudi:\/\/\/news\/(\d+)/i);
        if (deepLink) return `https://www.dongqiudi.com/article/${deepLink[1]}.html`;

        const normalized = normalizeUrl(candidate);
        if (normalized) return normalized;
    }

    return articleId ? `https://www.dongqiudi.com/article/${articleId}.html` : TEAM_URL;
}

function getArticleTitle(article) {
    const value = article?.title ?? article?.name ?? article?.headline;
    return typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value).trim();
}

function getArticleSummary(article) {
    const value = [article?.summary, article?.description, article?.digest, article?.intro, article?.subtitle].find(
        (item) => typeof item === 'string' && item.trim()
    );
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function getArticleImage(article) {
    const candidates = [
        article?.cover,
        article?.cover_url,
        article?.cover_path,
        article?.image,
        article?.image_url,
        article?.thumbnail,
        article?.thumb,
        article?.pic,
    ];
    return normalizeUrl(candidates.find((item) => typeof item === 'string' && item.trim()) || '');
}

function parseArticleDate(article) {
    const values = [article?.show_time, article?.published_at, article?.publish_time, article?.created_at, article?.updated_at];

    for (const value of values) {
        if (value === undefined || value === null || value === '') continue;

        if (typeof value === 'number' || /^\d+$/.test(String(value).trim())) {
            const timestamp = Number(value);
            const date = new Date(timestamp > 10_000_000_000 ? timestamp : timestamp * 1000);
            if (!Number.isNaN(date.getTime())) return date;
            continue;
        }

        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) return date;
    }

    return null;
}

function getCategories(article) {
    const raw = [article?.category, article?.secondary_category, article?.tag, article?.tags].flat(Infinity);
    const seen = new Set();
    const categories = [];

    for (const value of raw) {
        const name =
            typeof value === 'string'
                ? value.trim()
                : typeof value === 'object' && value
                  ? String(value.name || value.title || value.label || '').trim()
                  : '';
        if (name && !seen.has(name)) {
            seen.add(name);
            categories.push(name);
        }
    }

    return categories;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildDescription(summary, imageUrl) {
    const parts = [];
    if (summary) parts.push(`<p>${escapeHtml(summary)}</p>`);
    if (imageUrl) parts.push(`<p><img src="${escapeHtml(imageUrl)}" alt="" /></p>`);
    return parts.join('') || '<p>点击查看懂球帝原文。</p>';
}

function normalizeArticles(articles) {
    const seen = new Set();

    return articles
        .map((article) => {
            const id = getArticleId(article);
            const title = getArticleTitle(article);
            const url = getArticleUrl(article, id);
            const date = parseArticleDate(article);
            const guid = id ? `dongqiudi:team:${TEAM_ID}:${id}` : url;
            return {
                title,
                url,
                date,
                guid,
                summary: getArticleSummary(article),
                image: getArticleImage(article),
                categories: getCategories(article),
            };
        })
        .filter((article) => article.title && article.url && article.guid)
        .filter((article) => {
            if (seen.has(article.guid)) return false;
            seen.add(article.guid);
            return true;
        })
        .sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0))
        .slice(0, Number.isFinite(MAX_ITEMS) ? Math.max(1, MAX_ITEMS) : 50);
}

async function generateRss() {
    try {
        const [meta, apiResponse] = await Promise.all([
            getTeamMeta(),
            getWithRetry(API_URL, {
                params: {
                    id: TEAM_ID,
                    type: 'team',
                    size: Number.isFinite(MAX_ITEMS) ? Math.max(1, MAX_ITEMS) : 50,
                    platform: 'web',
                    version: '',
                },
            }),
        ]);

        const articles = normalizeArticles(getArticleList(apiResponse.data));
        if (!articles.length) throw new Error('Dongqiudi API returned no usable articles');

        const feed = new RSS({
            title: `${meta.name} - 懂球帝球队新闻`,
            description: `${meta.name} 的最新相关新闻，来源：懂球帝。`,
            feed_url: FEED_URL || undefined,
            site_url: SITE_URL,
            image_url: meta.image || undefined,
            language: 'zh-CN',
            ttl: 30,
        });

        for (const article of articles) {
            feed.item({
                title: article.title,
                description: buildDescription(article.summary, article.image),
                url: article.url,
                guid: article.guid,
                date: article.date || undefined,
                categories: article.categories,
            });
        }

        writeFileAtomic(OUTPUT_PATH, feed.xml({ indent: true }));
        console.log(`Generated ${articles.length} Dongqiudi articles at ${OUTPUT_PATH}`);
    } catch (error) {
        console.error(`Dongqiudi RSS generation failed: ${error && error.message ? error.message : error}`);
        if (fs.existsSync(OUTPUT_PATH)) console.error(`Keeping existing RSS file: ${OUTPUT_PATH}`);
        process.exitCode = 1;
    }
}

generateRss();
