import { ApiError, requestText } from '../lib/http.js';
const DONGHUA_LIFE_BASE_URL = 'https://www.donghualife.com';
const DONGHUA_LIFE_PREVIEW_URL = `${DONGHUA_LIFE_BASE_URL}/en-emision`;
const DONGHUA_LIFE_CATALOG_URL = `${DONGHUA_LIFE_BASE_URL}/donghuas`;
function decodeHtmlEntities(value) {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, '/')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}
function stripTags(value) {
    return value.replace(/<[^>]+>/g, ' ');
}
function normalizeText(value) {
    return decodeHtmlEntities(stripTags(value)).replace(/\s+/g, ' ').trim();
}
function toAbsoluteUrl(value) {
    return new URL(value, DONGHUA_LIFE_BASE_URL).toString();
}
function withDrupalPageParam(url, page) {
    if (page <= 1) {
        return url;
    }
    const parsed = new URL(url);
    parsed.searchParams.set('page', String(page - 1));
    return parsed.toString();
}
function extractSeriesSlug(value) {
    const match = value.match(/\/series\/([^/?#]+)/i);
    return match?.[1] ?? value.replace(/^\/+|\/+$/g, '');
}
function extractEpisodeRouteParam(value) {
    const match = value.match(/\/episode\/([^/?#]+)/i);
    return match?.[1] ?? value.replace(/^\/+|\/+$/g, '');
}
function extractEpisodeNumberFromRouteParam(value) {
    const normalized = value.trim();
    if (!normalized) {
        return null;
    }
    const explicitEpisodeMatch = normalized.match(/episodio-x(\d+(?:\.\d+)?)/i);
    if (explicitEpisodeMatch) {
        const parsed = Number(explicitEpisodeMatch[1]);
        return Number.isFinite(parsed) ? parsed : null;
    }
    const suffixMatch = normalized.match(/x(\d+(?:\.\d+)?)$/i);
    if (suffixMatch) {
        const parsed = Number(suffixMatch[1]);
        return Number.isFinite(parsed) ? parsed : null;
    }
    const numericTokens = normalized.match(/\d+(?:\.\d+)?/g);
    if (!numericTokens?.length) {
        return null;
    }
    const parsed = Number(numericTokens[numericTokens.length - 1]);
    return Number.isFinite(parsed) ? parsed : null;
}
function extractFirstNumber(value) {
    const match = value.match(/(\d+(?:\.\d+)?)/);
    if (!match) {
        return null;
    }
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
}
function cleanRecentEpisodeTitle(value) {
    const normalized = normalizeText(value);
    const match = normalized.match(/^(.*?)(?:\s*-\s*(\d+))?\s+episodio\s*x?\d+(?:\.\d+)?$/i);
    if (!match) {
        return normalized;
    }
    const [, baseTitle = '', season = ''] = match;
    return [baseTitle.trim(), season.trim()].filter(Boolean).join(' ');
}
function extractAnimeSlugFromEpisodeRouteParam(value) {
    const routeParam = extractEpisodeRouteParam(value);
    return routeParam
        .replace(/-episodio-x\d+(?:\.\d+)?$/i, '')
        .replace(/-\d+$/i, '')
        .replace(/^\/+|\/+$/g, '');
}
function parseRecentEpisodesFromHome(html) {
    const episodes = [];
    const seen = new Set();
    const pattern = /<div class="episodio[^\"]*">[\s\S]*?<img[^>]+src="([^\"]+)"[^>]*>[\s\S]*?<a href="([^\"]*\/episode\/[^\"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    for (const match of html.matchAll(pattern)) {
        const [, image = '', href = '', rawTitle = ''] = match;
        const routeParam = extractEpisodeRouteParam(href);
        const number = extractEpisodeNumberFromRouteParam(routeParam) ??
            extractEpisodeNumberFromRouteParam(normalizeText(rawTitle)) ??
            extractFirstNumber(normalizeText(rawTitle));
        const animeSlug = extractAnimeSlugFromEpisodeRouteParam(routeParam);
        const title = cleanRecentEpisodeTitle(rawTitle);
        if (!routeParam || !animeSlug || !title || !number || seen.has(routeParam)) {
            continue;
        }
        episodes.push({
            title,
            animeSlug,
            episodeSlug: routeParam,
            routeParam,
            number,
            cover: image ? toAbsoluteUrl(image) : undefined,
            url: toAbsoluteUrl(href),
        });
        seen.add(routeParam);
    }
    return episodes;
}
function uniqueBySlug(items) {
    const map = new Map();
    for (const item of items) {
        if (!map.has(item.slug)) {
            map.set(item.slug, item);
        }
    }
    return [...map.values()];
}
function sortEpisodes(episodes) {
    return [...episodes].sort((left, right) => {
        if (left.number !== right.number) {
            return left.number - right.number;
        }
        return (left.routeParam ?? left.slug).localeCompare(right.routeParam ?? right.slug);
    });
}
function parseListingCards(html) {
    const cardPattern = /<div class="serie">[\s\S]*?<a href="([^\"]*\/series\/[^\"]+)"[^>]*>[\s\S]*?<img[^>]+src="([^\"]+)"[^>]*>[\s\S]*?<div class="titulo">([\s\S]*?)<\/div>[\s\S]*?<div class="fecha">([\s\S]*?)<\/div>/gi;
    const media = [];
    for (const match of html.matchAll(cardPattern)) {
        const [, href = '', image = '', rawTitle = '', rawDate = ''] = match;
        const slug = extractSeriesSlug(href);
        const title = normalizeText(rawTitle);
        const year = normalizeText(rawDate);
        if (!slug || !title || !image) {
            continue;
        }
        media.push({
            title,
            slug,
            type: 'donghua',
            cover: toAbsoluteUrl(image),
            synopsis: year || undefined,
            rating: 'Donghualife',
            url: toAbsoluteUrl(href),
        });
    }
    return uniqueBySlug(media);
}
function parseListingPage(html, requestedPage, mode) {
    const media = parseListingCards(html);
    const pagerValues = Array.from(html.matchAll(/[?&]page=(\d+)/gi)).map((match) => Number(match[1]) + 1);
    const foundPages = Math.max(requestedPage, 1, ...pagerValues);
    const hasNextPage = /pager__item--next/i.test(html);
    const hasPreviousPage = /pager__item--previous/i.test(html);
    return {
        currentPage: requestedPage,
        hasNextPage,
        previousPage: hasPreviousPage ? String(Math.max(1, requestedPage - 1)) : null,
        nextPage: hasNextPage ? String(requestedPage + 1) : null,
        foundPages,
        media,
        mode,
    };
}
function parseCoverFromHtml(html) {
    const coverMatch = html.match(/field--name-field-poster[\s\S]*?<img[^>]+src="([^\"]+)"/i);
    if (coverMatch?.[1]) {
        return toAbsoluteUrl(coverMatch[1]);
    }
    const ogMatch = html.match(/<meta property="og:image" content="([^\"]+)"/i);
    if (ogMatch?.[1]) {
        return toAbsoluteUrl(ogMatch[1]);
    }
    return undefined;
}
function parseSeasonLinks(html) {
    const links = new Set();
    for (const match of html.matchAll(/href="([^\"]*\/season\/[^\"]+)"/gi)) {
        const href = match[1];
        if (href) {
            links.add(toAbsoluteUrl(href));
        }
    }
    return [...links];
}
function parseSeasonEpisodes(html) {
    const episodes = [];
    const rowPattern = /<tr>[\s\S]*?<th[^>]*>([\s\S]*?)<\/th>[\s\S]*?<td><a href="([^\"]*\/episode\/[^\"]+)">([\s\S]*?)<\/a>[\s\S]*?<\/td>[\s\S]*?<\/tr>/gi;
    for (const match of html.matchAll(rowPattern)) {
        const [, rawNumber = '', href = '', rawLabel = ''] = match;
        const routeParam = extractEpisodeRouteParam(href);
        const number = extractEpisodeNumberFromRouteParam(routeParam) ??
            extractFirstNumber(normalizeText(rawNumber)) ??
            extractEpisodeNumberFromRouteParam(normalizeText(rawLabel)) ??
            extractFirstNumber(normalizeText(rawLabel));
        if (!routeParam || !number) {
            continue;
        }
        episodes.push({
            number,
            slug: routeParam,
            routeParam,
            url: toAbsoluteUrl(href),
        });
    }
    return episodes;
}
function parseServers(html) {
    const servers = [];
    const serverPattern = /<a class="toggle-enlace[^\"]*"[^>]*data-video="([^\"]+)"[^>]*title="([^\"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    for (const match of html.matchAll(serverPattern)) {
        const [, rawUrl = '', rawTitle = '', rawLabel = ''] = match;
        const url = rawUrl.trim();
        const name = normalizeText(rawLabel) || normalizeText(rawTitle) || 'Servidor';
        if (!url) {
            continue;
        }
        servers.push({
            name,
            embed: url,
            download: url,
        });
    }
    if (servers.length > 0) {
        return servers;
    }
    const iframeMatch = html.match(/<iframe id="iframe-episode" src="([^\"]+)"/i);
    if (iframeMatch?.[1]) {
        return [
            {
                name: 'Principal',
                embed: iframeMatch[1],
                download: iframeMatch[1],
            },
        ];
    }
    return [];
}
function buildSeriesUrl(slug) {
    return `${DONGHUA_LIFE_BASE_URL}/series/${slug.replace(/^\/+|\/+$/g, '')}`;
}
function buildSeasonUrl(slug) {
    return `${DONGHUA_LIFE_BASE_URL}/season/${slug.replace(/^\/+|\/+$/g, '')}`;
}
function buildEpisodeUrl(routeParam) {
    return `${DONGHUA_LIFE_BASE_URL}/episode/${routeParam.replace(/^\/+|\/+$/g, '')}`;
}
export async function getDonghuaLifeRecentEpisodes(signal) {
    const response = await requestText(DONGHUA_LIFE_BASE_URL, signal);
    return parseRecentEpisodesFromHome(response.bodyText).slice(0, 18);
}
export async function getDonghuaLifePreview(signal) {
    const response = await requestText(DONGHUA_LIFE_PREVIEW_URL, signal);
    return parseListingCards(response.bodyText).slice(0, 12);
}
export async function getDonghuaLifeCatalog(page = 1, signal) {
    const response = await requestText(withDrupalPageParam(DONGHUA_LIFE_CATALOG_URL, page), signal);
    return parseListingPage(response.bodyText, page, 'catalog');
}
export async function searchDonghuaLife(query, page = 1, signal) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
        return {
            currentPage: 1,
            hasNextPage: false,
            previousPage: null,
            nextPage: null,
            foundPages: 0,
            media: [],
            mode: 'text',
        };
    }
    const searchUrl = new URL(`${DONGHUA_LIFE_BASE_URL}/search`);
    searchUrl.searchParams.set('search_api_fulltext', normalizedQuery);
    if (page > 1) {
        searchUrl.searchParams.set('page', String(page - 1));
    }
    const response = await requestText(searchUrl.toString(), signal);
    return parseListingPage(response.bodyText, page, 'text');
}
export async function getDonghuaLifeDetail(slug, signal) {
    const response = await requestText(buildSeriesUrl(slug), signal);
    const html = response.bodyText;
    const title = normalizeText(html.match(/field--name-title[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '') ||
        normalizeText(html.match(/<title>([\s\S]*?)\|/i)?.[1] ?? '');
    if (!title) {
        throw new ApiError('No pude leer el detalle del donghua.', 502);
    }
    const originalTitle = normalizeText(html.match(/field--name-field-titulo-original[\s\S]*?field__item">([\s\S]*?)<\/div>/i)?.[1] ?? '');
    const status = normalizeText(html.match(/field--name-field-estado[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? '');
    const synopsis = normalizeText(html.match(/field--name-field-synopsis[\s\S]*?field__item">([\s\S]*?)<\/div>/i)?.[1] ?? '');
    const genres = Array.from(html.matchAll(/field--name-field-genero[\s\S]*?<a href="\/donghuas\/[^\"]+"[^>]*>([\s\S]*?)<\/a>/gi))
        .map((match) => normalizeText(match[1] ?? ''))
        .filter(Boolean);
    const seasonLinks = parseSeasonLinks(html);
    const seasonHtmlList = await Promise.all(seasonLinks.map(async (seasonUrl) => {
        try {
            const seasonResponse = await requestText(seasonUrl, signal);
            return seasonResponse.bodyText;
        }
        catch {
            return null;
        }
    }));
    const episodeMap = new Map();
    for (const seasonHtml of seasonHtmlList) {
        if (!seasonHtml) {
            continue;
        }
        for (const episode of parseSeasonEpisodes(seasonHtml)) {
            if (!episode.routeParam || !episodeMap.has(episode.routeParam)) {
                episodeMap.set(episode.routeParam ?? episode.slug, episode);
            }
        }
    }
    return {
        title,
        slug,
        type: 'donghua',
        cover: parseCoverFromHtml(html),
        synopsis,
        rating: 'Donghualife',
        alternativeTitles: originalTitle ? [originalTitle] : [],
        status: status || 'Sin estado',
        genres,
        nextAiringEpisode: null,
        episodes: sortEpisodes([...episodeMap.values()]),
        related: [],
        url: buildSeriesUrl(slug),
    };
}
export async function getDonghuaLifeEpisode(slug, episodeRouteParam, signal) {
    const response = await requestText(buildEpisodeUrl(episodeRouteParam), signal);
    const html = response.bodyText;
    const servers = parseServers(html);
    if (servers.length === 0) {
        throw new ApiError('Donghualife no devolvio servidores para este episodio.', 502);
    }
    const seriesHref = html.match(/<a href="([^\"]*\/series\/[^\"]+)" class="home-serie"/i)?.[1] ?? '';
    const animeSlug = extractSeriesSlug(seriesHref) || slug;
    const title = normalizeText(html.match(/field--name-title[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '') ||
        `${slug} - ${episodeRouteParam}`;
    const number = extractEpisodeNumberFromRouteParam(episodeRouteParam) ??
        extractEpisodeNumberFromRouteParam(title) ??
        extractFirstNumber(title) ??
        1;
    return {
        animeSlug,
        title,
        number,
        routeParam: episodeRouteParam,
        servers,
    };
}
