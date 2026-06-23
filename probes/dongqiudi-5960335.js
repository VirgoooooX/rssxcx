const fs = require('node:fs');
const path = require('node:path');

const articleId = '5960335';
const webAppUrl = `https://n.dongqiudi.com/webapp/news.html?articleId=${articleId}`;
const mobileUrl = `https://m.dongqiudi.com/article/${articleId}.html`;
const endpoints = [
    { name: 'webapp-shell', url: webAppUrl, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    { name: 'mobile-article', url: mobileUrl, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    { name: 'v2-detail-path', url: `https://api.dongqiudi.com/v2/article/detail/${articleId}`, accept: 'application/json, text/plain, */*' },
    { name: 'v3-detail-path', url: `https://api.dongqiudi.com/v3/article/detail/${articleId}`, accept: 'application/json, text/plain, */*' },
    { name: 'v3-detail-query', url: `https://api.dongqiudi.com/v3/article/detail?article_id=${articleId}`, accept: 'application/json, text/plain, */*' },
];

const headers = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Referer: webAppUrl,
};

function count(text, pattern) {
    return (text.match(pattern) || []).length;
}

function looksLikeHtml(value) {
    return typeof value === 'string' && /<\/?(?:p|div|img|figure|br|article|h[1-6])\b/i.test(value);
}

function inspectJson(value, currentPath = '$', matches = [], seen = new Set(), depth = 0) {
    if (depth > 12 || value === null || value === undefined) return matches;
    if (typeof value === 'string') {
        if (looksLikeHtml(value)) {
            matches.push({
                path: currentPath,
                htmlLength: value.length,
                imageCount: count(value, /<img\b/gi),
                paragraphCount: count(value, /<p\b/gi),
            });
        }
        return matches;
    }
    if (typeof value !== 'object' || seen.has(value)) return matches;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
        inspectJson(child, `${currentPath}.${key}`, matches, seen, depth + 1);
    }
    return matches;
}

async function inspectEndpoint(endpoint) {
    const startedAt = Date.now();
    try {
        const response = await fetch(endpoint.url, {
            headers: { ...headers, Accept: endpoint.accept },
            redirect: 'follow',
            signal: AbortSignal.timeout(20000),
        });
        const body = await response.text();
        const contentType = response.headers.get('content-type') || '';
        const item = {
            name: endpoint.name,
            requestedUrl: endpoint.url,
            finalUrl: response.url,
            status: response.status,
            contentType,
            bytes: Buffer.byteLength(body),
            elapsedMs: Date.now() - startedAt,
        };

        if (contentType.includes('json') || body.trim().startsWith('{') || body.trim().startsWith('[')) {
            try {
                const parsed = JSON.parse(body);
                item.topLevelKeys = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed) : [];
                item.dataKeys = parsed?.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data) ? Object.keys(parsed.data) : [];
                item.htmlFields = inspectJson(parsed).slice(0, 20);
            } catch (error) {
                item.jsonParseError = error.message;
            }
        } else {
            item.markers = {
                articleTag: /<article\b/i.test(body),
                nuxtData: /__NUXT_DATA__/i.test(body),
                nuxtLegacy: /__NUXT__/i.test(body),
                initialState: /__INITIAL_STATE__/i.test(body),
                articleContentClass: /article[-_]?content|articleContent|detail[-_]?content/i.test(body),
                imageTagCount: count(body, /<img\b/gi),
                bodyLikeClassCount: count(body, /(?:article[-_]?content|articleContent|detail[-_]?content)/gi),
            };
        }
        return item;
    } catch (error) {
        return {
            name: endpoint.name,
            requestedUrl: endpoint.url,
            error: error.name,
            message: error.message,
            elapsedMs: Date.now() - startedAt,
        };
    }
}

(async () => {
    const report = {
        articleId,
        generatedAt: new Date().toISOString(),
        note: 'This probe stores endpoint structure and content metrics only; it does not store article text or HTML.',
        endpoints: [],
    };

    for (const endpoint of endpoints) {
        report.endpoints.push(await inspectEndpoint(endpoint));
    }

    const outputPath = path.join('debug', `dongqiudi-${articleId}-probe.json`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));
})();
