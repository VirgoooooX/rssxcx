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
const USER_AGENT = process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeFileAtomic(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
    fs.writeFileSync(temp, content, 'utf8');
    fs.renameSync(temp, filePath);
}

async function getWithRetry(url, options = {}) {
    let lastError;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
        try {
            return await axios.get(url, {
                timeout: TIMEOUT_MS,
                maxRedirects: 5,
                responseType: options.responseType,
                params: options.params,
                headers: {
                    Accept: options.accept || 'application/json, text/plain, */*',
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                    'User-Agent': USER_AGENT,
                    Referer: TEAM_URL,
                },
                validateStatus: (status) => status >= 200 && status < 400,
            });
        } catch (error) {
            lastError = error;
            if (attempt < RETRIES) await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
        }
    }
    throw lastError;
}

function absoluteUrl(value, base = 'https://www.dongqiudi.com') {
    if (typeof value !== 'string' || !value.trim() || value.trim().startsWith('javascript:')) return '';
    try {
        return new URL(value.trim().startsWith('//') ? `https:${value.trim()}` : value.trim(), base).href;
    } catch {
        return '';
    }
}

function articleId(item) {
    const value = item?.id ?? item?.article_id ?? item?.object_id;
    return value === null || value === undefined || value === '' ? '' : String(value);
}

function articleUrl(item, id) {
    // API often returns n.dongqiudi.com WebApp shell URLs. Mobile article URLs are direct readable pages.
    if (id) return `https://m.dongqiudi.com/article/${id}.html`;
    return absoluteUrl(item?.share_url || item?.url || item?.web_url || item?.link || '') || TEAM_URL;
}

function articleTitle(item) {
    const value = item?.title ?? item?.name ?? item?.headline;
    return value === null || value === undefined ? '' : String(value).trim();
}

function articleSummary(item) {
    const value = [item?.summary, item?.description, item?.digest, item?.intro, item?.subtitle].find((x) => typeof x === 'string' && x.trim());
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function articleImage(item) {
    const value = [item?.cover, item?.cover_url, item?.cover_path, item?.image, item?.image_url, item?.thumbnail, item?.thumb, item?.pic].find((x) => typeof x === 'string' && x.trim());
    return absoluteUrl(value || '');
}

function articleDate(item) {
    for (const value of [item?.show_time, item?.published_at, item?.publish_time, item?.created_at, item?.updated_at]) {
        if (value === undefined || value === null || value === '') continue;
        const numeric = Number(value);
        const date = Number.isFinite(numeric) && String(value).trim() !== ''
            ? new Date(numeric > 1e10 ? numeric : numeric * 1000)
            : new Date(value);
        if (!Number.isNaN(date.getTime())) return date;
    }
    return null;
}

function categories(item) {
    const values = [item?.category, item?.secondary_category, item?.tag, item?.tags].flat(Infinity);
    return [...new Set(values.map((value) => typeof value === 'string' ? value.trim() : String(value?.name || value?.title || '').trim()).filter(Boolean))];
}

function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function description(summary, image) {
    return `${summary ? `<p>${escapeHtml(summary)}</p>` : ''}${image ? `<p><img src="${escapeHtml(image)}" alt="" /></p>` : ''}` || '<p>点击查看懂球帝原文。</p>';
}

async function teamMeta() {
    try {
        const { data: html } = await getWithRetry(TEAM_URL, { responseType: 'text', accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' });
        const $ = cheerio.load(html);
        const rawName = $('meta[property="og:title"]').attr('content') || $('title').text();
        const name = String(rawName || TEAM_NAME || `懂球帝球队 ${TEAM_ID}`).replace(/\s*[|｜_-]\s*懂球帝.*$/i, '').replace(/\s*[-_|｜]\s*足球比分.*$/i, '').trim();
        const image = absoluteUrl($('meta[property="og:image"]').attr('content') || '');
        return { name: name || TEAM_NAME || `懂球帝球队 ${TEAM_ID}`, image };
    } catch {
        return { name: TEAM_NAME || `懂球帝球队 ${TEAM_ID}`, image: '' };
    }
}

async function generate() {
    try {
        const [meta, response] = await Promise.all([
            teamMeta(),
            getWithRetry(API_URL, { params: { id: TEAM_ID, type: 'team', size: Number.isFinite(MAX_ITEMS) ? Math.max(1, MAX_ITEMS) : 50, platform: 'web', version: '' } }),
        ]);
        const list = [response.data?.data?.articles, response.data?.data?.data?.articles, response.data?.articles].find(Array.isArray);
        if (!list) throw new Error('Unexpected Dongqiudi API payload: articles array not found');

        const seen = new Set();
        const items = list.map((item) => {
            const id = articleId(item);
            const url = articleUrl(item, id);
            return { id, title: articleTitle(item), url, date: articleDate(item), summary: articleSummary(item), image: articleImage(item), categories: categories(item) };
        }).filter((item) => item.title && item.url).filter((item) => {
            const key = item.id || item.url;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }).sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0)).slice(0, Number.isFinite(MAX_ITEMS) ? Math.max(1, MAX_ITEMS) : 50);

        if (!items.length) throw new Error('Dongqiudi API returned no usable articles');
        const feed = new RSS({ title: `${meta.name} - 懂球帝球队新闻`, description: `${meta.name} 的最新相关新闻，来源：懂球帝。`, feed_url: FEED_URL || undefined, site_url: SITE_URL, image_url: meta.image || undefined, language: 'zh-CN', ttl: 30 });
        for (const item of items) {
            feed.item({ title: item.title, description: description(item.summary, item.image), url: item.url, guid: item.id ? `dongqiudi:team:${TEAM_ID}:${item.id}` : item.url, date: item.date || undefined, categories: item.categories });
        }
        writeFileAtomic(OUTPUT_PATH, feed.xml({ indent: true }));
        console.log(`Generated ${items.length} Dongqiudi list articles at ${OUTPUT_PATH}`);
    } catch (error) {
        console.error(`Dongqiudi RSS generation failed: ${error?.message || error}`);
        if (fs.existsSync(OUTPUT_PATH)) console.error(`Keeping existing RSS file: ${OUTPUT_PATH}`);
        process.exitCode = 1;
    }
}

generate();
