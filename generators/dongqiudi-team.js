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
const STATE_PATH = process.env.STATE_PATH || path.join(__dirname, '..', 'state', 'dongqiudi', `team-${TEAM_ID}.json`);
const MAX_ITEMS = Number.parseInt(process.env.MAX_ITEMS || '50', 10);
const FULL_CONTENT = !['0', 'false', 'no', 'off'].includes(String(process.env.FULL_CONTENT ?? 'true').trim().toLowerCase());
const FULL_CONTENT_LIMIT = Number.parseInt(process.env.FULL_CONTENT_LIMIT || '12', 10);
const ARTICLE_CONCURRENCY = Number.parseInt(process.env.ARTICLE_CONCURRENCY || '2', 10);
const STATE_MAX_ARTICLES = Number.parseInt(process.env.STATE_MAX_ARTICLES || '200', 10);
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

function ensureDirectory(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeFileAtomic(filePath, content) {
    ensureDirectory(filePath);
    const base = path.basename(filePath);
    const tmpPath = path.join(path.dirname(filePath), `.${base}.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, filePath);
}

function loadState() {
    try {
        const parsed = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
        if (parsed && typeof parsed === 'object' && parsed.articles && typeof parsed.articles === 'object') {
            return { version: 1, articles: parsed.articles };
        }
    } catch (error) {
        if (error.code !== 'ENOENT') console.warn(`Could not read state: ${error.message}`);
    }
    return { version: 1, articles: {} };
}

function writeState(state) {
    writeFileAtomic(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
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
    if (!input || input.startsWith('javascript:')) return '';
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

function buildSummaryHtml(summary, imageUrl) {
    const parts = [];
    if (summary) parts.push(`<p>${escapeHtml(summary)}</p>`);
    if (imageUrl) parts.push(`<p><img src="${escapeHtml(imageUrl)}" alt="" /></p>`);
    return parts.join('') || '<p>点击查看懂球帝原文。</p>';
}

function isUsableHtml(value) {
    if (typeof value !== 'string') return false;
    const text = value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    return text.length >= 80 || /<img\b/i.test(value);
}

function extractBalancedJson(text, marker) {
    const markerIndex = text.indexOf(marker);
    if (markerIndex === -1) return null;

    const equalsIndex = text.indexOf('=', markerIndex + marker.length);
    if (equalsIndex === -1) return null;
    const startMatch = text.slice(equalsIndex + 1).match(/[\[{]/);
    if (!startMatch) return null;
    const start = equalsIndex + 1 + startMatch.index;
    const open = text[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let quote = '';
    let escaped = false;

    for (let index = start; index < text.length; index++) {
        const char = text[index];
        if (quote) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === quote) quote = '';
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }
        if (char === open) depth += 1;
        else if (char === close) {
            depth -= 1;
            if (depth === 0) {
                try {
                    return JSON.parse(text.slice(start, index + 1));
                } catch (_) {
                    return null;
                }
            }
        }
    }
    return null;
}

function collectHtmlCandidates(value, candidates = [], seen = new Set(), depth = 0) {
    if (depth > 10 || value === null || value === undefined) return candidates;
    if (typeof value === 'string') {
        if (isUsableHtml(value)) candidates.push(value);
        return candidates;
    }
    if (typeof value !== 'object' || seen.has(value)) return candidates;
    seen.add(value);

    const priorityKeys = ['body', 'content', 'articleContent', 'article_content', 'html', 'detail'];
    for (const key of priorityKeys) {
        if (typeof value[key] === 'string' && isUsableHtml(value[key])) candidates.push(value[key]);
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
        collectHtmlCandidates(child, candidates, seen, depth + 1);
    }
    return candidates;
}

function unflattenNuxtValue(rawData, index, cache = new Map()) {
    if (cache.has(index)) return cache.get(index);
    if (!Number.isInteger(index) || index < 0 || index >= rawData.length) return null;
    const value = rawData[index];
    if (value === null || typeof value !== 'object') return value;

    if (Array.isArray(value)) {
        const output = [];
        cache.set(index, output);
        for (const child of value) output.push(unflattenNuxtValue(rawData, child, cache));
        return output;
    }

    const output = {};
    cache.set(index, output);
    for (const [key, child] of Object.entries(value)) {
        output[key] = typeof child === 'number' ? unflattenNuxtValue(rawData, child, cache) : child;
    }
    return output;
}

function extractHtmlFromSerializedState(html) {
    const candidates = [];
    const initialState = extractBalancedJson(html, 'window.__INITIAL_STATE__');
    if (initialState) collectHtmlCandidates(initialState, candidates);

    const $ = cheerio.load(html);
    const nuxtData = $('#__NUXT_DATA__').html();
    if (nuxtData) {
        try {
            const rawData = JSON.parse(nuxtData);
            const cache = new Map();
            for (let index = 0; index < rawData.length; index++) {
                const value = rawData[index];
                if (!value || typeof value !== 'object') continue;
                const keySet = Object.keys(value);
                if (!keySet.some((key) => ['body', 'content', 'articleContent', 'article_content', 'html'].includes(key))) continue;
                collectHtmlCandidates(unflattenNuxtValue(rawData, index, cache), candidates);
            }
        } catch (_) {
            // DOM extraction and summary fallback remain available.
        }
    }

    return candidates.sort((a, b) => b.length - a.length)[0] || '';
}

function extractDomArticleHtml($) {
    const selectors = [
        'article .article-content',
        'article [class*="article-content"]',
        'article [class*="articleContent"]',
        'article [class*="detail-content"]',
        '.article-content',
        '[class*="article-content"]',
        '[class*="articleContent"]',
        '[class*="detail-content"]',
        '[data-testid*="article-content"]',
    ];
    const seen = new Set();
    const candidates = [];

    for (const selector of selectors) {
        $(selector).each((_, element) => {
            if (seen.has(element)) return;
            seen.add(element);
            const html = $(element).html() || '';
            const textLength = $(element).text().replace(/\s+/g, ' ').trim().length;
            const imageCount = $(element).find('img').length;
            if (textLength < 80 && imageCount === 0) return;
            candidates.push({ html, score: textLength + imageCount * 600 });
        });
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.html || '';
}

function chooseImageSource($, element, baseUrl) {
    const candidates = [
        $(element).attr('src'),
        $(element).attr('data-src'),
        $(element).attr('data-original'),
        $(element).attr('data-origin'),
        $(element).attr('data-lazy-src'),
        $(element).attr('data-gif-src'),
        $(element).attr('orig-src'),
        $(element).attr('original'),
    ];

    for (const candidate of candidates) {
        if (typeof candidate !== 'string' || !candidate.trim()) continue;
        if (/^(data:|about:blank)/i.test(candidate.trim())) continue;
        const url = normalizeUrl(candidate, baseUrl);
        if (url) return url;
    }
    return '';
}

function sanitizeArticleHtml(rawHtml, articleUrl) {
    if (!rawHtml) return '';
    const $ = cheerio.load(`<div id="rss-content-root">${rawHtml}</div>`, null, false);
    const root = $('#rss-content-root');

    root.find('script, style, noscript, form, input, button, textarea, svg, canvas, object, embed').remove();
    root.find('[class*="advert" i], [id*="advert" i], [class*="recommend" i], [class*="related" i], [class*="comment" i], [class*="download" i]').remove();

    root.find('iframe, video, audio').each((_, element) => {
        const src = normalizeUrl($(element).attr('src') || $(element).attr('data-src') || '', articleUrl);
        if (src) $(element).replaceWith(`<p><a href="${escapeHtml(src)}">点击原文查看视频或媒体</a></p>`);
        else $(element).remove();
    });

    root.find('img').each((_, element) => {
        const src = chooseImageSource($, element, articleUrl);
        if (!src) {
            $(element).remove();
            return;
        }
        const alt = ($(element).attr('alt') || '').trim();
        $(element).attr('src', src);
        $(element).attr('alt', alt);
        $(element).removeAttr('srcset sizes data-src data-original data-origin data-lazy-src data-gif-src orig-src original style class id width height loading');
    });

    root.find('a').each((_, element) => {
        const originalHref = ($(element).attr('href') || '').trim();
        const deepLink = originalHref.match(/^dongqiudi:\/\/\/news\/(\d+)/i);
        const href = deepLink ? `https://www.dongqiudi.com/article/${deepLink[1]}.html` : normalizeUrl(originalHref, articleUrl);
        if (href) $(element).attr('href', href);
        else $(element).removeAttr('href');
        $(element).removeAttr('style class id target rel');
    });

    root.find('*').each((_, element) => {
        const allowed = new Set(['href', 'src', 'alt', 'title']);
        for (const attribute of Object.keys(element.attribs || {})) {
            if (!allowed.has(attribute.toLowerCase())) $(element).removeAttr(attribute);
        }
    });

    root.find('p, div, figure, figcaption, li').each((_, element) => {
        const node = $(element);
        if (!node.text().replace(/\s+/g, '').length && node.find('img, a').length === 0) node.remove();
    });

    const html = root.html()?.trim() || '';
    return isUsableHtml(html) ? html : '';
}

async function fetchArticleContent(article) {
    const { data: html } = await getWithRetry(article.url, {
        responseType: 'text',
        headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    });
    const $ = cheerio.load(html);
    const rawHtml = extractDomArticleHtml($) || extractHtmlFromSerializedState(html);
    const contentHtml = sanitizeArticleHtml(rawHtml, article.url);
    if (!contentHtml) throw new Error('Article content container was not found or contained no usable content');

    const author =
        $('[rel="author"]').first().text().trim() ||
        $('[class*="author" i]').first().text().trim() ||
        getMetaContent($, 'meta[name="author"]');

    return { contentHtml, author };
}

async function mapWithConcurrency(items, concurrency, worker) {
    const results = new Array(items.length);
    let cursor = 0;
    const workerCount = Math.max(1, Math.min(Number.isFinite(concurrency) ? concurrency : 1, items.length || 1));

    await Promise.all(
        Array.from({ length: workerCount }, async () => {
            while (cursor < items.length) {
                const index = cursor++;
                try {
                    results[index] = await worker(items[index], index);
                } catch (error) {
                    results[index] = { error };
                }
            }
        })
    );

    return results;
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

function updateStateMetadata(state, article) {
    const existing = state.articles[article.guid] || {};
    state.articles[article.guid] = {
        ...existing,
        title: article.title,
        url: article.url,
        date: article.date ? article.date.toISOString() : existing.date || '',
        summary: article.summary,
        image: article.image,
        categories: article.categories,
    };
}

function pruneState(state) {
    const kept = Object.entries(state.articles)
        .sort(([, a], [, b]) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
        .slice(0, Number.isFinite(STATE_MAX_ARTICLES) ? Math.max(50, STATE_MAX_ARTICLES) : 200);
    state.articles = Object.fromEntries(kept);
}

async function enrichNewArticles(state, articles) {
    if (!FULL_CONTENT) return;

    const candidates = articles
        .filter((article) => !state.articles[article.guid]?.contentHtml)
        .slice(0, Number.isFinite(FULL_CONTENT_LIMIT) ? Math.max(0, FULL_CONTENT_LIMIT) : 12);
    if (!candidates.length) return;

    const now = new Date().toISOString();
    const results = await mapWithConcurrency(candidates, ARTICLE_CONCURRENCY, async (article) => {
        const extracted = await fetchArticleContent(article);
        return { article, extracted };
    });

    for (const result of results) {
        if (!result) continue;
        if (result.error) {
            const article = candidates[results.indexOf(result)];
            if (!article) continue;
            const existing = state.articles[article.guid] || {};
            state.articles[article.guid] = {
                ...existing,
                lastContentAttemptAt: now,
                contentError: String(result.error.message || result.error).slice(0, 300),
            };
            console.warn(`Could not fetch full article ${article.guid}: ${result.error.message || result.error}`);
            continue;
        }

        const { article, extracted } = result;
        const existing = state.articles[article.guid] || {};
        state.articles[article.guid] = {
            ...existing,
            contentHtml: extracted.contentHtml,
            author: extracted.author || existing.author || '',
            contentFetchedAt: now,
            lastContentAttemptAt: now,
            contentError: '',
        };
    }
}

function renderArticleHtml(article, stateEntry) {
    return stateEntry?.contentHtml || buildSummaryHtml(article.summary, article.image);
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

        const state = loadState();
        for (const article of articles) updateStateMetadata(state, article);
        await enrichNewArticles(state, articles);
        pruneState(state);
        writeState(state);

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
            const stateEntry = state.articles[article.guid];
            const html = renderArticleHtml(article, stateEntry);
            feed.item({
                title: article.title,
                description: html,
                url: article.url,
                guid: article.guid,
                date: article.date || undefined,
                categories: article.categories,
                author: stateEntry?.author || undefined,
                custom_elements: [{ 'content:encoded': { _cdata: html } }],
            });
        }

        writeFileAtomic(OUTPUT_PATH, feed.xml({ indent: true }));
        console.log(`Generated ${articles.length} Dongqiudi articles at ${OUTPUT_PATH} (${FULL_CONTENT ? 'full content enabled' : 'summary mode'})`);
    } catch (error) {
        console.error(`Dongqiudi RSS generation failed: ${error && error.message ? error.message : error}`);
        if (fs.existsSync(OUTPUT_PATH)) console.error(`Keeping existing RSS file: ${OUTPUT_PATH}`);
        process.exitCode = 1;
    }
}

generateRss();
