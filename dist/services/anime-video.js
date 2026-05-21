import { createDecipheriv, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
const HTML_ACCEPT_HEADER = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const EMBED_FETCH_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';
const MEDIA_EXTENSION_PATTERN = /\.(m3u8|mp4|webm|ogg|m4v)(?:$|[?#])/i;
const BLOCKED_MEDIA_HOST_PATTERNS = [
    'doubleclick.net',
    'googlesyndication.com',
    'googleadservices.com',
    'adnxs.com',
    'adskeeper.co.uk',
    'adsterra.com',
    'exoclick.com',
    'propellerads.com',
    'popads.net',
    'adcash.com',
    'trafficstars.com',
    'juicyads.com',
    'onclickmega.com',
    'onclickperformance.com',
    'hilltopads.net',
    'outbrain.com',
    'taboola.com',
];
const BLOCKED_MEDIA_URL_FRAGMENTS = [
    'doubleclick',
    'googlesyndication',
    'googleadservices',
    'adnxs',
    'adskeeper',
    'adsterra',
    'exoclick',
    'propellerads',
    'popads',
    'adcash',
    'trafficstars',
    'juicyads',
    'onclickmega',
    'onclickperformance',
    'hilltopads',
    'outbrain',
    'taboola',
    'popunder',
    'vast',
    'banner',
    'advert',
];
const MAX_PAGE_RESOLUTION_DEPTH = 3;
const BYSE_VIDEO_HOST_PATTERNS = ['byse.com', 'bysesukior.com'];
const RESOLVED_VIDEO_CACHE = new Map();
const PROXY_TOKEN_TTL_MS = 30 * 60 * 1000;
const proxyTokenStore = new Map();
function getUrlScheme(value) {
    const match = `${value ?? ''}`.trim().match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
    return match?.[1]?.toLowerCase() ?? '';
}
function isHttpUrl(value) {
    const scheme = getUrlScheme(value);
    return scheme === 'http' || scheme === 'https';
}
function isMegaLikeServer(server) {
    const fingerprint = `${server?.name ?? ''} ${server?.download ?? ''} ${server?.embed ?? ''}`.toLowerCase();
    return fingerprint.includes('mega.nz') || fingerprint.includes('mega.co.nz') || fingerprint.includes('mega');
}
function hostMatchesPattern(host, pattern) {
    return host === pattern || host.endsWith(`.${pattern}`);
}
function getNormalizedHost(value) {
    if (!value) {
        return null;
    }
    try {
        return new URL(value).hostname.trim().toLowerCase() || null;
    }
    catch {
        return null;
    }
}
function decodeBase64UrlToBuffer(value) {
    const normalizedValue = `${value ?? ''}`.trim();
    if (!normalizedValue) {
        return null;
    }
    const base64 = normalizedValue.replace(/-/g, '+').replace(/_/g, '/');
    const padding = base64.length % 4 === 0 ? 0 : 4 - (base64.length % 4);
    try {
        return Buffer.from(`${base64}${'='.repeat(padding)}`, 'base64');
    }
    catch {
        return null;
    }
}
function getRegistrableDomain(host) {
    if (!host) {
        return null;
    }
    const parts = host.trim().toLowerCase().split('.').filter(Boolean);
    if (parts.length === 0) {
        return null;
    }
    if (parts.length <= 2) {
        return parts.join('.');
    }
    return parts.slice(-2).join('.');
}
function getDirectVideoContentType(value) {
    if (!value) {
        return 'progressive';
    }
    try {
        const path = new URL(value).pathname.toLowerCase();
        return path.endsWith('.m3u8') ? 'hls' : 'progressive';
    }
    catch {
        return String(value).toLowerCase().includes('.m3u8') ? 'hls' : 'progressive';
    }
}
function getContentTypeFromResponseHeader(value) {
    const lowerValue = `${value ?? ''}`.trim().toLowerCase();
    if (!lowerValue) {
        return null;
    }
    if (lowerValue.includes('application/vnd.apple.mpegurl') ||
        lowerValue.includes('application/x-mpegurl')) {
        return 'hls';
    }
    if (lowerValue.startsWith('video/') ||
        lowerValue.includes('application/mp4') ||
        lowerValue.includes('application/octet-stream')) {
        return 'progressive';
    }
    return null;
}
function matchesByseVideoHost(value) {
    const host = getNormalizedHost(value);
    if (!host) {
        return false;
    }
    return BYSE_VIDEO_HOST_PATTERNS.some((pattern) => hostMatchesPattern(host, pattern));
}
function extractByseVideoCode(value) {
    if (!value || !matchesByseVideoHost(value)) {
        return null;
    }
    try {
        const url = new URL(value);
        const match = url.pathname.match(/^\/e\/([^/?#]+)/i);
        return match?.[1]?.trim() || null;
    }
    catch {
        return null;
    }
}
function normalizeExtractedValue(value) {
    let nextValue = value.trim();
    nextValue = nextValue.replace(/^['"`]+|['"`]+$/g, '');
    nextValue = nextValue
        .replace(/\\u0026/gi, '&')
        .replace(/\\u002f/gi, '/')
        .replace(/\\u003a/gi, ':')
        .replace(/\\u003d/gi, '=')
        .replace(/\\u0025/gi, '%')
        .replace(/\\u002d/gi, '-')
        .replace(/\\u005f/gi, '_')
        .replace(/\\x3a/gi, ':')
        .replace(/\\x2f/gi, '/')
        .replace(/\\x3d/gi, '=')
        .replace(/\\x26/gi, '&')
        .replace(/\\\//g, '/')
        .replace(/&amp;/gi, '&');
    if (nextValue.startsWith('//')) {
        nextValue = `https:${nextValue}`;
    }
    try {
        if (/%(?:2f|3a|3d|26)/i.test(nextValue)) {
            nextValue = decodeURIComponent(nextValue);
        }
    }
    catch {
        // keep original candidate
    }
    return nextValue;
}
function matchesBlockedMediaUrl(value) {
    if (!value) {
        return false;
    }
    const lowerValue = value.trim().toLowerCase();
    if (!lowerValue) {
        return false;
    }
    if (BLOCKED_MEDIA_URL_FRAGMENTS.some((fragment) => lowerValue.includes(fragment))) {
        return true;
    }
    try {
        const host = new URL(value).hostname.trim().toLowerCase();
        return BLOCKED_MEDIA_HOST_PATTERNS.some((pattern) => hostMatchesPattern(host, pattern));
    }
    catch {
        return BLOCKED_MEDIA_URL_FRAGMENTS.some((fragment) => lowerValue.includes(fragment));
    }
}
function isStreamtapePlayableUrl(value, baseUrl) {
    if (!value) {
        return null;
    }
    try {
        const url = baseUrl ? new URL(value, baseUrl) : new URL(value);
        const host = url.hostname.trim().toLowerCase();
        const path = url.pathname.trim().toLowerCase();
        if ((host.includes('streamtape') || host.includes('stape')) &&
            path.includes('/get_video') &&
            url.searchParams.has('id')) {
            const serializedUrl = url.toString();
            return matchesBlockedMediaUrl(serializedUrl) ? null : serializedUrl;
        }
    }
    catch {
        return null;
    }
    return null;
}
function getPlayableVideoUrlWithBase(value, baseUrl) {
    if (!value) {
        return null;
    }
    const normalizedValue = normalizeExtractedValue(value);
    try {
        const url = baseUrl ? new URL(normalizedValue, baseUrl) : new URL(normalizedValue);
        const serializedUrl = url.toString();
        if (MEDIA_EXTENSION_PATTERN.test(serializedUrl)) {
            return matchesBlockedMediaUrl(serializedUrl) ? null : serializedUrl;
        }
        return isStreamtapePlayableUrl(serializedUrl);
    }
    catch {
        return null;
    }
}
function buildFetchHeaders(pageUrl, accept = HTML_ACCEPT_HEADER, range) {
    const headers = {
        Accept: accept,
        'User-Agent': EMBED_FETCH_USER_AGENT,
    };
    try {
        const page = new URL(pageUrl);
        headers.Referer = page.toString();
        headers.Origin = page.origin;
    }
    catch {
        // noop
    }
    if (range) {
        headers.Range = range;
    }
    return headers;
}
function buildProxyFetchHeaders(targetUrl, referer, range) {
    const headers = buildFetchHeaders(referer ?? targetUrl, '*/*', range);
    if (!headers.Referer) {
        headers.Referer = targetUrl;
    }
    try {
        headers.Origin = new URL(referer ?? targetUrl).origin;
    }
    catch {
        // noop
    }
    return headers;
}
function addExtractedCandidate(collection, rawValue, baseUrl) {
    const playableUrl = getPlayableVideoUrlWithBase(rawValue, baseUrl);
    if (playableUrl) {
        collection.add(playableUrl);
    }
}
function addNestedPageCandidate(collection, rawValue, baseUrl) {
    if (!rawValue) {
        return;
    }
    const normalizedValue = normalizeExtractedValue(rawValue);
    try {
        const url = new URL(normalizedValue, baseUrl ?? undefined);
        const serializedUrl = url.toString();
        if (!isHttpUrl(serializedUrl) || matchesBlockedMediaUrl(serializedUrl)) {
            return;
        }
        collection.add(serializedUrl);
    }
    catch {
        // ignore malformed nested page candidates
    }
}
function extractDirectVideoCandidates(html, baseUrl) {
    const matches = new Set();
    const patterns = [
        /(?:file|src)\s*[:=]\s*["'`]([^"'`]+)["'`]/gi,
        /<source[^>]+src=["'`]([^"'`]+)["'`]/gi,
        /["'`](https?:\/\/[^"'`\s<>]+(?:\.m3u8|\.mp4|\.webm|\.ogg|\.m4v)(?:\?[^"'`\s<>]*)?)["'`]/gi,
        /["'`](\/\/[^"'`\s<>]+(?:\.m3u8|\.mp4|\.webm|\.ogg|\.m4v)(?:\?[^"'`\s<>]*)?)["'`]/gi,
        /["'`](https?:\/\/[^"'`\s<>]*streamtape[^"'`\s<>]*\/get_video\?[^"'`\s<>]+)["'`]/gi,
        /["'`](https?:\/\/[^"'`\s<>]*stape[^"'`\s<>]*\/get_video\?[^"'`\s<>]+)["'`]/gi,
        /(https?:\\\/\\\/[^"'`\s<>]+(?:\.m3u8|\.mp4|\.webm|\.ogg|\.m4v)(?:\?[^"'`\s<>]*)?)/gi,
        /(https?:\\\/\\\/[^"'`\s<>]*streamtape[^"'`\s<>]*\\\/get_video\?[^"'`\s<>]+)/gi,
        /(https?:\\\/\\\/[^"'`\s<>]*stape[^"'`\s<>]*\\\/get_video\?[^"'`\s<>]+)/gi,
        /(\/\/[^"'`\s<>]+(?:\.m3u8|\.mp4|\.webm|\.ogg|\.m4v)(?:\?[^"'`\s<>]*)?)/gi,
    ];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(html)) !== null) {
            addExtractedCandidate(matches, match[1], baseUrl);
        }
    }
    return Array.from(matches);
}
function extractNestedPageCandidates(html, baseUrl) {
    const matches = new Set();
    const patterns = [
        /<iframe[^>]+src=["'`]([^"'`]+)["'`]/gi,
        /iframe\.src\s*=\s*["'`]([^"'`]+)["'`]/gi,
        /location\.href\s*=\s*["'`]([^"'`]+)["'`]/gi,
        /["'`](https?:\/\/[^"'`\s<>]+\/e\/[^"'`\s<>]+)["'`]/gi,
        /["'`](https?:\/\/[^"'`\s<>]+\/embed\/[^"'`\s<>]+)["'`]/gi,
        /(https?:\\\/\\\/[^"'`\s<>]+\\\/e\\\/[^"'`\s<>]+)/gi,
    ];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(html)) !== null) {
            addNestedPageCandidate(matches, match[1], baseUrl);
        }
    }
    return Array.from(matches);
}
function scoreCandidate(candidateUrl, pageUrl) {
    let score = 0;
    const lowerValue = candidateUrl.toLowerCase();
    const candidateHost = getNormalizedHost(candidateUrl);
    const pageHost = getNormalizedHost(pageUrl);
    const candidateDomain = getRegistrableDomain(candidateHost);
    const pageDomain = getRegistrableDomain(pageHost);
    if (lowerValue.includes('.m3u8')) {
        score += 60;
    }
    if (lowerValue.includes('.mp4') || lowerValue.includes('.m4v')) {
        score += 30;
    }
    if (candidateHost && pageHost && candidateHost === pageHost) {
        score += 20;
    }
    else if (candidateDomain && pageDomain === candidateDomain) {
        score += 12;
    }
    if (lowerValue.includes('master') || lowerValue.includes('playlist')) {
        score += 8;
    }
    if (matchesBlockedMediaUrl(candidateUrl)) {
        score -= 100;
    }
    return score;
}
function scoreNestedPageCandidate(candidateUrl, pageUrl) {
    let score = 0;
    const lowerValue = candidateUrl.toLowerCase();
    const candidateHost = getNormalizedHost(candidateUrl);
    const pageHost = getNormalizedHost(pageUrl);
    const candidateDomain = getRegistrableDomain(candidateHost);
    const pageDomain = getRegistrableDomain(pageHost);
    if (matchesByseVideoHost(candidateUrl)) {
        score += 80;
    }
    if (lowerValue.includes('/e/')) {
        score += 40;
    }
    if (lowerValue.includes('/embed/')) {
        score += 24;
    }
    if (candidateHost && pageHost && candidateHost === pageHost) {
        score += 20;
    }
    else if (candidateDomain && pageDomain && candidateDomain === pageDomain) {
        score += 12;
    }
    if (matchesBlockedMediaUrl(candidateUrl)) {
        score -= 100;
    }
    return score;
}
function decryptBysePlaybackPayload(playback) {
    if (!playback?.key_parts?.length) {
        return null;
    }
    const key = Buffer.concat(playback.key_parts
        .map((part) => decodeBase64UrlToBuffer(part))
        .filter((part) => Boolean(part)));
    if (key.length !== 32) {
        return null;
    }
    const candidates = [
        { iv: playback.iv, payload: playback.payload },
        { iv: playback.iv2, payload: playback.payload2 },
    ];
    for (const candidate of candidates) {
        const iv = decodeBase64UrlToBuffer(candidate.iv);
        const encryptedPayload = decodeBase64UrlToBuffer(candidate.payload);
        if (!iv || !encryptedPayload || encryptedPayload.length <= 16) {
            continue;
        }
        try {
            const authTag = encryptedPayload.subarray(encryptedPayload.length - 16);
            const ciphertext = encryptedPayload.subarray(0, encryptedPayload.length - 16);
            const decipher = createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(authTag);
            const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
            return JSON.parse(plaintext);
        }
        catch {
            // try the next payload candidate
        }
    }
    return null;
}
function pickBestByseSource(payload) {
    const sources = Array.isArray(payload?.sources) ? payload.sources : [];
    const rankedSources = sources
        .map((source) => {
        const playableUrl = getPlayableVideoUrlWithBase(source.url);
        if (!playableUrl) {
            return null;
        }
        let score = 0;
        const lowerMimeType = `${source.mime_type ?? ''}`.trim().toLowerCase();
        if (lowerMimeType.includes('mpegurl')) {
            score += 70;
        }
        else if (lowerMimeType.startsWith('video/')) {
            score += 40;
        }
        if (Number.isFinite(source.bitrate_kbps)) {
            score += Number(source.bitrate_kbps) / 25;
        }
        if (Number.isFinite(source.height)) {
            score += Number(source.height) / 10;
        }
        return {
            url: playableUrl,
            contentType: lowerMimeType.includes('mpegurl') || playableUrl.toLowerCase().includes('.m3u8')
                ? 'hls'
                : 'progressive',
            score,
        };
    })
        .filter((source) => Boolean(source))
        .sort((left, right) => right.score - left.score);
    const bestSource = rankedSources[0];
    if (!bestSource) {
        return null;
    }
    return {
        url: bestSource.url,
        contentType: bestSource.contentType,
    };
}
async function resolveByseVideoPage(pageUrl, resolvedFrom, signal) {
    const videoCode = extractByseVideoCode(pageUrl);
    if (!videoCode) {
        return null;
    }
    let apiUrl;
    try {
        apiUrl = new URL(`/api/videos/${encodeURIComponent(videoCode)}/`, new URL(pageUrl).origin).toString();
    }
    catch {
        return null;
    }
    const response = await fetch(apiUrl, {
        headers: buildFetchHeaders(pageUrl, 'application/json,*/*;q=0.8'),
        redirect: 'follow',
        signal,
    });
    if (!response.ok) {
        return null;
    }
    const payload = (await response.json());
    const decryptedPayload = decryptBysePlaybackPayload(payload.playback);
    const bestSource = pickBestByseSource(decryptedPayload);
    if (!bestSource) {
        return null;
    }
    return {
        url: bestSource.url,
        referer: pageUrl,
        contentType: bestSource.contentType,
        resolvedFrom,
    };
}
function purgeExpiredProxyTokens() {
    const now = Date.now();
    for (const [token, entry] of proxyTokenStore.entries()) {
        if (entry.expiresAt <= now) {
            proxyTokenStore.delete(token);
        }
    }
}
function createProxyToken(targetUrl, referer) {
    purgeExpiredProxyTokens();
    const token = randomUUID();
    proxyTokenStore.set(token, {
        targetUrl,
        referer,
        expiresAt: Date.now() + PROXY_TOKEN_TTL_MS,
    });
    return token;
}
function buildProxyPath(targetUrl, referer) {
    const token = createProxyToken(targetUrl, referer);
    return `/api/anime/video/proxy/${token}`;
}
async function tryResolveCandidatePage(pageUrl, resolvedFrom, signal, depth = 0, visited = new Set()) {
    if (!isHttpUrl(pageUrl) || depth > MAX_PAGE_RESOLUTION_DEPTH || visited.has(pageUrl)) {
        return null;
    }
    visited.add(pageUrl);
    if (matchesByseVideoHost(pageUrl)) {
        const byseResolvedVideo = await resolveByseVideoPage(pageUrl, resolvedFrom, signal);
        if (byseResolvedVideo) {
            return byseResolvedVideo;
        }
    }
    const response = await fetch(pageUrl, {
        headers: buildFetchHeaders(pageUrl),
        redirect: 'follow',
        signal,
    });
    if (!response.ok) {
        return null;
    }
    const finalUrl = response.url || pageUrl;
    const directContentType = getContentTypeFromResponseHeader(response.headers.get('content-type'));
    if (directContentType) {
        return {
            url: finalUrl,
            referer: pageUrl,
            contentType: directContentType,
            resolvedFrom,
        };
    }
    visited.add(finalUrl);
    if (matchesByseVideoHost(finalUrl)) {
        const byseResolvedVideo = await resolveByseVideoPage(finalUrl, resolvedFrom, signal);
        if (byseResolvedVideo) {
            return byseResolvedVideo;
        }
    }
    const html = await response.text();
    const extractedCandidates = extractDirectVideoCandidates(html, finalUrl).sort((left, right) => scoreCandidate(right, finalUrl) - scoreCandidate(left, finalUrl));
    const bestCandidate = extractedCandidates[0];
    const nestedCandidates = extractNestedPageCandidates(html, finalUrl).sort((left, right) => scoreNestedPageCandidate(right, finalUrl) - scoreNestedPageCandidate(left, finalUrl));
    if (bestCandidate) {
        return {
            url: bestCandidate,
            referer: finalUrl,
            contentType: getDirectVideoContentType(bestCandidate),
            resolvedFrom,
        };
    }
    for (const nestedCandidate of nestedCandidates) {
        const resolvedVideo = await tryResolveCandidatePage(nestedCandidate, resolvedFrom, signal, depth + 1, visited);
        if (resolvedVideo) {
            return resolvedVideo;
        }
    }
    return null;
}
export async function resolveAnimeVideoServer(server, signal) {
    if (!server || isMegaLikeServer(server)) {
        return null;
    }
    const cacheKey = JSON.stringify({
        name: server.name,
        download: server.download ?? null,
        embed: server.embed ?? null,
    });
    if (RESOLVED_VIDEO_CACHE.has(cacheKey)) {
        return RESOLVED_VIDEO_CACHE.get(cacheKey) ?? null;
    }
    const directDownloadUrl = getPlayableVideoUrlWithBase(server.download) ?? getPlayableVideoUrlWithBase(server.embed);
    if (directDownloadUrl) {
        const resolvedDirectVideo = {
            url: directDownloadUrl,
            proxyUrl: buildProxyPath(directDownloadUrl, server.embed ?? server.download ?? undefined),
            contentType: getDirectVideoContentType(directDownloadUrl),
            resolvedFrom: 'direct',
        };
        RESOLVED_VIDEO_CACHE.set(cacheKey, resolvedDirectVideo);
        return resolvedDirectVideo;
    }
    const candidates = [];
    if (isHttpUrl(server.download)) {
        candidates.push({ url: server.download.trim(), kind: 'download' });
    }
    if (isHttpUrl(server.embed)) {
        candidates.push({ url: server.embed.trim(), kind: 'embed' });
    }
    for (const candidate of candidates) {
        try {
            const resolvedVideo = await tryResolveCandidatePage(candidate.url, candidate.kind, signal);
            if (resolvedVideo) {
                const payload = {
                    url: resolvedVideo.url,
                    proxyUrl: buildProxyPath(resolvedVideo.url, resolvedVideo.referer),
                    contentType: resolvedVideo.contentType,
                    resolvedFrom: resolvedVideo.resolvedFrom,
                };
                RESOLVED_VIDEO_CACHE.set(cacheKey, payload);
                return payload;
            }
        }
        catch {
            // continue with next candidate
        }
    }
    RESOLVED_VIDEO_CACHE.set(cacheKey, null);
    return null;
}
function isPlaylistResponse(contentType, targetUrl) {
    const lowerType = `${contentType ?? ''}`.toLowerCase();
    return (lowerType.includes('application/vnd.apple.mpegurl') ||
        lowerType.includes('application/x-mpegurl') ||
        targetUrl.toLowerCase().includes('.m3u8'));
}
function rewritePlaylistBody(body, manifestUrl, referer) {
    return body
        .split(/\r?\n/)
        .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            return line;
        }
        try {
            const absoluteUrl = new URL(trimmed, manifestUrl).toString();
            return buildProxyPath(absoluteUrl, referer ?? manifestUrl);
        }
        catch {
            return line;
        }
    })
        .join('\n');
}
export async function proxyAnimeVideoRequest(request, reply) {
    purgeExpiredProxyTokens();
    const entry = proxyTokenStore.get(request.params.token);
    if (!entry) {
        return reply.status(404).send({ success: false, error: 'Expired or unknown video token.' });
    }
    const rangeHeader = typeof request.headers.range === 'string' ? request.headers.range : null;
    const upstreamResponse = await fetch(entry.targetUrl, {
        headers: buildProxyFetchHeaders(entry.targetUrl, entry.referer, rangeHeader),
        redirect: 'follow',
        signal: request.signal,
    });
    reply.status(upstreamResponse.status);
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
    const contentType = upstreamResponse.headers.get('content-type');
    const shouldRewritePlaylist = isPlaylistResponse(contentType, entry.targetUrl);
    const passthroughHeaders = [
        'content-type',
        'content-range',
        'accept-ranges',
        'cache-control',
        'etag',
        'last-modified',
    ];
    if (!shouldRewritePlaylist) {
        passthroughHeaders.push('content-length');
    }
    for (const headerName of passthroughHeaders) {
        const value = upstreamResponse.headers.get(headerName);
        if (value) {
            reply.header(headerName, value);
        }
    }
    if (shouldRewritePlaylist) {
        const body = await upstreamResponse.text();
        const rewrittenBody = rewritePlaylistBody(body, upstreamResponse.url || entry.targetUrl, entry.referer);
        reply.header('content-type', contentType ?? 'application/vnd.apple.mpegurl');
        return reply.send(rewrittenBody);
    }
    if (!upstreamResponse.body) {
        const buffer = Buffer.from(await upstreamResponse.arrayBuffer());
        return reply.send(buffer);
    }
    return reply.send(Readable.fromWeb(upstreamResponse.body));
}
