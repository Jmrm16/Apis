import { createContext, runInContext } from 'node:vm';
import { ApiError, requestText } from '../lib/http.js';
const SERIES_DONGHUA_BASE_URL = 'https://seriesdonghua.com';
const SERIES_DONGHUA_ON_AIR_URL = `${SERIES_DONGHUA_BASE_URL}/donghuas-en-emision`;
function decodeHtmlEntities(value) {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ');
}
function stripTags(value) {
    return value.replace(/<[^>]+>/g, ' ');
}
function normalizeText(value) {
    return decodeHtmlEntities(stripTags(value)).replace(/\s+/g, ' ').trim();
}
function toAbsoluteUrl(value) {
    return new URL(value, SERIES_DONGHUA_BASE_URL).toString();
}
function extractSlug(value) {
    try {
        const parsed = new URL(value, SERIES_DONGHUA_BASE_URL);
        return parsed.pathname.replace(/^\/+|\/+$/g, '');
    }
    catch {
        return value.replace(/^\/+|\/+$/g, '');
    }
}
function buildSeriesUrl(slug) {
    return `${SERIES_DONGHUA_BASE_URL}/${slug.replace(/^\/+|\/+$/g, '')}/`;
}
function buildEpisodeUrl(slug, number) {
    return `${SERIES_DONGHUA_BASE_URL}/${slug.replace(/^\/+|\/+$/g, '')}-episodio-${number}/`;
}
function extractFirstNumber(value) {
    const match = value.match(/(\d+(?:\.\d+)?)/);
    if (!match) {
        return null;
    }
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
}
function sortEpisodes(episodes) {
    return [...episodes].sort((left, right) => left.number - right.number);
}
function parsePlatformLabels(html) {
    const platformLabels = new Map();
    const platformPattern = /<li id="([^"]+)_tab"[\s\S]*?<a[^>]+href="#([^"]+)"[^>]*>[\s\S]*?<\/i>\s*([^<]+?)(?:\s*<span|\s*<\/a>)/g;
    for (const match of html.matchAll(platformPattern)) {
        const [, idPlatform = '', hrefPlatform = '', rawLabel = ''] = match;
        const platform = hrefPlatform || idPlatform;
        const label = normalizeText(rawLabel);
        if (platform && label) {
            platformLabels.set(platform, label);
        }
    }
    return platformLabels;
}
function unpackPlayerScript(html) {
    const packedScriptMatch = html.match(/<script>var _0x[a-f0-9]+=.*?eval\(function\(h,u,n,t,e,r\)\{[\s\S]*?<\/script>/i);
    if (!packedScriptMatch) {
        return null;
    }
    let script = packedScriptMatch[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
    const evalPrefix = 'eval(function(h,u,n,t,e,r){';
    if (!script.includes(evalPrefix)) {
        return null;
    }
    script = script.replace(evalPrefix, 'globalThis.__decoded=(function(h,u,n,t,e,r){');
    script = script.replace(/\)\)\s*$/, '));');
    const context = {
        globalThis: {},
    };
    createContext(context);
    runInContext(script, context);
    const decoded = context.globalThis.__decoded;
    return typeof decoded === 'string' ? decoded : null;
}
function parseVideoMap(unpackedScript) {
    const match = unpackedScript.match(/VIDEO_MAP_JSON\s*=\s*(\{[\s\S]*?\})\s*;/);
    if (!match) {
        return {};
    }
    const normalizedJson = match[1].replace(/(?<!\\)\\"/g, '"');
    const rawMap = JSON.parse(normalizedJson);
    const normalizedMap = {};
    for (const [platform, encodedValue] of Object.entries(rawMap)) {
        try {
            const innerJson = encodedValue.replace(/\\"/g, '"');
            const decodedValue = JSON.parse(innerJson);
            if (decodedValue) {
                normalizedMap[platform] = decodedValue.split('\\/').join('/');
            }
        }
        catch {
            continue;
        }
    }
    return normalizedMap;
}
function toEmbeddedVideoUrl(platform, value) {
    if (platform === 'asura') {
        return `https://www.dailymotion.com/embed/video/${value}`;
    }
    return value;
}
function parseCoverFromHtml(html) {
    const metaMatch = html.match(/<meta property="og:image" content="([^"]+)"/i);
    if (metaMatch?.[1]) {
        return toAbsoluteUrl(metaMatch[1]);
    }
    const bannerMatch = html.match(/<div class="banner-serie" style="background-image:\s*url\(([^)]+)\)"/i);
    if (bannerMatch?.[1]) {
        return toAbsoluteUrl(bannerMatch[1].replace(/^['"]|['"]$/g, ''));
    }
    return undefined;
}
export async function getSeriesDonghuaPreview(signal) {
    const response = await requestText(SERIES_DONGHUA_ON_AIR_URL, signal);
    const html = response.bodyText;
    const itemPattern = /<div class="item col-lg-3 col-md-3 col-xs-6">\s*<a href="([^"]+)" class="angled-img">[\s\S]*?<img src="([^"]+)"[^>]*>[\s\S]*?<h5[^>]*>([\s\S]*?)<\/h5>/g;
    const media = [];
    for (const match of html.matchAll(itemPattern)) {
        const [, href = '', image = '', rawTitle = ''] = match;
        const title = normalizeText(rawTitle);
        if (!href || !image || !title) {
            continue;
        }
        const url = toAbsoluteUrl(href);
        const slug = extractSlug(url);
        media.push({
            title,
            slug,
            type: 'donghua',
            cover: toAbsoluteUrl(image),
            rating: 'SeriesDonghua',
            url,
        });
        if (media.length >= 12) {
            break;
        }
    }
    return media;
}
export async function getSeriesDonghuaDetail(slug, signal) {
    const response = await requestText(buildSeriesUrl(slug), signal);
    const html = response.bodyText;
    const title = normalizeText(html.match(/<div class="sf fc-dark ls-title-serie">([\s\S]*?)<\/div>/i)?.[1] ?? '') ||
        normalizeText(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '');
    if (!title) {
        throw new ApiError('No pude leer el detalle del donghua.', 502);
    }
    const status = normalizeText(html.match(/Estado:\s*<\/div>[\s\S]*?<span class="badge bg-default">([\s\S]*?)<\/span>/i)?.[1] ??
        '');
    const synopsis = normalizeText(html.match(/Sinopsis<\/div>[\s\S]*?<div class="text-justify fc-dark">([\s\S]*?)<\/div>/i)?.[1] ?? '');
    const genres = Array.from(html.matchAll(/<a href="[^"]+" class="generos[^"]*">[\s\S]*?<span class="label[^"]*">([\s\S]*?)<\/span>/g))
        .map((match) => normalizeText(match[1] ?? ''))
        .filter(Boolean);
    const episodes = [];
    const episodesBlock = html.match(/<ul class="donghua-list">([\s\S]*?)<\/ul>/i)?.[1] ?? '';
    for (const match of episodesBlock.matchAll(/<a href="([^"]+)"[^>]*>[\s\S]*?<blockquote[^>]*>([\s\S]*?)<\/blockquote>/g)) {
        const [, href = '', rawLabel = ''] = match;
        const url = toAbsoluteUrl(href);
        const episodeSlug = extractSlug(url);
        const number = extractFirstNumber(episodeSlug) ?? extractFirstNumber(rawLabel);
        if (!number) {
            continue;
        }
        episodes.push({
            number,
            slug: episodeSlug,
            url,
        });
    }
    return {
        title,
        slug,
        type: 'donghua',
        cover: parseCoverFromHtml(html),
        synopsis,
        rating: 'SeriesDonghua',
        alternativeTitles: [],
        status: status || 'Sin estado',
        genres,
        nextAiringEpisode: null,
        episodes: sortEpisodes(episodes),
        related: [],
        url: buildSeriesUrl(slug),
    };
}
export async function getSeriesDonghuaEpisode(slug, episodeNumber, signal) {
    const response = await requestText(buildEpisodeUrl(slug, episodeNumber), signal);
    const html = response.bodyText;
    const platformLabels = parsePlatformLabels(html);
    const unpackedScript = unpackPlayerScript(html);
    if (!unpackedScript) {
        throw new ApiError('No pude extraer los servidores del donghua.', 502);
    }
    const videoMap = parseVideoMap(unpackedScript);
    const servers = [...platformLabels.entries()]
        .map(([platform, name]) => {
        const source = videoMap[platform];
        if (!source) {
            return null;
        }
        const embedTarget = toEmbeddedVideoUrl(platform, source);
        return {
            name,
            embed: embedTarget,
            download: embedTarget,
        };
    })
        .filter((server) => Boolean(server));
    if (servers.length === 0) {
        throw new ApiError('SeriesDonghua no devolvio servidores para este episodio.', 502);
    }
    const seriesTitle = normalizeText(html.match(/<title>([\s\S]*?)【/i)?.[1] ?? '') || slug;
    return {
        animeSlug: slug,
        title: `${seriesTitle} - ${episodeNumber}`,
        number: episodeNumber,
        servers,
    };
}
