import { ApiError, requestText } from '../lib/http.js';
const DEFAULT_ANIMEMOVIL_BASE_URL = 'https://animemovil2.com';
const BROWSER_HEADERS = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
};
const FILTER_STATUS_MAP = {
    1: '2',
    2: '1',
    3: '3',
};
const FILTER_TYPE_MAP = {
    movie: '2',
    ova: '3',
    special: '4',
    tv: '1',
};
const FILTER_GENRE_MAP = {
    accion: '1',
    aventura: '23',
    comedia: '5',
    drama: '6',
    fantasia: '13',
    romance: '3',
    shounen: '9',
    sobrenatural: '12',
};
function trimTrailingSlash(value) {
    return value.replace(/\/+$/, '');
}
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
function normalizeType(value) {
    const normalized = normalizeText(value).toLowerCase();
    switch (normalized) {
        case 'tv anime':
        case 'tv':
            return 'tv';
        case 'pelicula':
        case 'película':
        case 'movie':
            return 'movie';
        case 'especial':
            return 'special';
        case 'ova':
            return 'ova';
        case 'ona':
            return 'ona';
        case 'donghua':
            return 'donghua';
        default:
            return normalized;
    }
}
function toAbsoluteUrl(baseUrl, value) {
    return new URL(value, baseUrl).toString();
}
function resolveUrl(baseUrl, value) {
    return new URL(value, baseUrl).toString();
}
function extractPath(baseUrl, value) {
    try {
        return new URL(value, baseUrl).pathname.replace(/^\/+|\/+$/g, '');
    }
    catch {
        return value.replace(/^\/+|\/+$/g, '');
    }
}
function extractSeriesSlug(baseUrl, value) {
    return extractPath(baseUrl, value).replace(/^ver\//, '');
}
function extractEpisodeSlug(baseUrl, value) {
    return extractPath(baseUrl, value).replace(/^ver\//, '');
}
function extractLastNumber(value) {
    const numericTokens = normalizeText(value).match(/\d+(?:\.\d+)?/g);
    if (!numericTokens?.length) {
        return null;
    }
    const parsed = Number(numericTokens[numericTokens.length - 1]);
    return Number.isFinite(parsed) ? parsed : null;
}
function extractAnimeSlugFromEpisodeSlug(episodeSlug, episodeNumber) {
    const suffix = `-${episodeNumber}`;
    if (episodeSlug.endsWith(suffix)) {
        return episodeSlug.slice(0, -suffix.length);
    }
    return episodeSlug.replace(/-\d+(?:\.\d+)?$/, '');
}
function buildSeriesUrl(baseUrl, slug) {
    return `${trimTrailingSlash(baseUrl)}/${slug.replace(/^\/+|\/+$/g, '')}`;
}
function buildEpisodeUrl(baseUrl, animeSlug, episodeNumber) {
    return `${trimTrailingSlash(baseUrl)}/ver/${animeSlug.replace(/^\/+|\/+$/g, '')}-${episodeNumber}`;
}
async function requestAnimeMovilText(baseUrl, pathOrUrl, signal) {
    const response = await requestText(resolveUrl(baseUrl, pathOrUrl), signal, {
        headers: BROWSER_HEADERS,
    });
    return response.bodyText;
}
function getFirstFilterValue(values, dictionary) {
    for (const value of values) {
        const mapped = dictionary[value.trim().toLowerCase()];
        if (mapped) {
            return mapped;
        }
    }
    return null;
}
function getFirstStatusValue(values) {
    for (const value of values) {
        const mapped = FILTER_STATUS_MAP[value];
        if (mapped) {
            return mapped;
        }
    }
    return null;
}
function normalizePaginationValue(value) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}
function buildDirectoryUrl(baseUrl, params) {
    const url = new URL('/directorio/', baseUrl);
    const query = params.query.trim();
    const status = getFirstStatusValue(params.statuses);
    const type = getFirstFilterValue(params.types, FILTER_TYPE_MAP);
    const genre = getFirstFilterValue(params.genres, FILTER_GENRE_MAP);
    const page = normalizePaginationValue(params.page);
    if (query) {
        url.searchParams.set('q', query);
    }
    if (status) {
        url.searchParams.set('estado', status);
    }
    if (type) {
        url.searchParams.set('tipo', type);
    }
    if (genre) {
        url.searchParams.set('genero', genre);
    }
    if (page > 1) {
        url.searchParams.set('p', String(page));
    }
    return url.toString();
}
function extractListItemBlocks(sectionHtml) {
    return Array.from(sectionHtml.matchAll(/<li>\s*<article>([\s\S]*?)<\/article>\s*<\/li>/gi))
        .map((match) => match[1] ?? '')
        .filter(Boolean);
}
function parseDirectoryCards(html, baseUrl) {
    const listHtml = html.match(/<ul class="grid-animes directorio">([\s\S]*?)<\/ul>/i)?.[1] ??
        html.match(/<ul class="grid-animes">([\s\S]*?)<\/ul>/i)?.[1] ??
        '';
    const cards = [];
    for (const block of extractListItemBlocks(listHtml)) {
        const href = block.match(/<a href="([^"]+)"/i)?.[1] ?? '';
        const type = normalizeType(block.match(/<span class="tipo">([\s\S]*?)<\/span>/i)?.[1] ?? '');
        const year = normalizeText(block.match(/<span class="estreno">([\s\S]*?)<\/span>/i)?.[1] ?? '');
        const status = normalizeText(block.match(/<p class="gray">([\s\S]*?)<\/p>/i)?.[1] ?? '');
        const cover = block.match(/<img loading="lazy" class="skeleton" src="([^"]+)"/i)?.[1] ?? '';
        const paragraphMatches = Array.from(block.matchAll(/<p(?: class="[^"]*")?>([\s\S]*?)<\/p>/gi))
            .map((match) => normalizeText(match[1] ?? ''))
            .filter(Boolean);
        const title = paragraphMatches[paragraphMatches.length - 1] ?? '';
        const slug = href ? extractSeriesSlug(baseUrl, href) : '';
        if (!href || !slug || !title) {
            continue;
        }
        cards.push({
            title,
            slug,
            type: type || 'tv',
            year: year || undefined,
            status: status || undefined,
            cover: cover ? toAbsoluteUrl(baseUrl, cover) : undefined,
            url: toAbsoluteUrl(baseUrl, href),
        });
    }
    return cards;
}
function parseDirectoryPage(html, baseUrl, requestedPage, mode) {
    const cards = parseDirectoryCards(html, baseUrl);
    const listedPages = Array.from(html.matchAll(/[?&]p=(\d+)/gi)).map((match) => Number(match[1]));
    const currentPage = Number(html.match(/class="active page-item active"><a class="page-link"[^>]*>(\d+)<\/a>/i)?.[1] ?? '') ||
        requestedPage;
    const foundPages = Math.max(currentPage, requestedPage, 1, ...listedPages);
    const hasNextPage = /page-controller right(?![^"]*disabledd)/i.test(html);
    const hasPreviousPage = /page-controller left(?![^"]*disabledd)/i.test(html);
    return {
        currentPage,
        hasNextPage,
        previousPage: hasPreviousPage ? String(Math.max(1, currentPage - 1)) : null,
        nextPage: hasNextPage ? String(currentPage + 1) : null,
        foundPages,
        media: cards.map((card) => ({
            title: card.title,
            slug: card.slug,
            type: card.type,
            cover: card.cover,
            synopsis: [card.status, card.year].filter(Boolean).join(' • ') || undefined,
            url: card.url,
        })),
        mode,
    };
}
function parseLatestEpisodes(html, baseUrl) {
    const latestSection = html.match(/<h2><i class="icon fas fa-burn icon-pink"><\/i>Últimos Episodios<\/h2>[\s\S]*?<ul class="grid-animes">([\s\S]*?)<\/ul>/i)?.[1] ?? '';
    const episodes = [];
    for (const block of extractListItemBlocks(latestSection)) {
        const href = block.match(/<a href="([^"]*\/ver\/[^"]+)"/i)?.[1] ?? '';
        const episodeLabel = block.match(/<p class="yellow">([\s\S]*?)<\/p>/i)?.[1] ?? '';
        const cover = block.match(/<img loading="lazy" class="skeleton" src="([^"]+)"/i)?.[1] ?? '';
        const paragraphMatches = Array.from(block.matchAll(/<p(?: class="[^"]*")?>([\s\S]*?)<\/p>/gi))
            .map((match) => normalizeText(match[1] ?? ''))
            .filter(Boolean);
        const title = paragraphMatches[paragraphMatches.length - 1] ?? '';
        const episodeSlug = href ? extractEpisodeSlug(baseUrl, href) : '';
        const number = extractLastNumber(episodeLabel) ?? extractLastNumber(episodeSlug);
        if (!href || !episodeSlug || !number || !title) {
            continue;
        }
        episodes.push({
            title,
            animeSlug: extractAnimeSlugFromEpisodeSlug(episodeSlug, number),
            episodeSlug,
            number,
            cover: cover ? toAbsoluteUrl(baseUrl, cover) : undefined,
            url: toAbsoluteUrl(baseUrl, href),
        });
    }
    return episodes;
}
function normalizeEpisodeLinks(episodes) {
    const episodeMap = new Map();
    for (const episode of episodes) {
        if (!Number.isFinite(episode.number) || episode.number <= 0) {
            continue;
        }
        const current = episodeMap.get(episode.number);
        if (!current || (!current.url && episode.url) || (!current.slug && episode.slug)) {
            episodeMap.set(episode.number, episode);
        }
    }
    return [...episodeMap.values()].sort((left, right) => left.number - right.number);
}
function parseCover(html, baseUrl) {
    const cover = html.match(/<meta property="og:image" content="([^"]+)"/i)?.[1] ??
        html.match(/<img id="anime_image"[^>]+src="([^"]+)"/i)?.[1] ??
        html.match(/<img class="blur-background"[^>]+src="([^"]+)"/i)?.[1] ??
        '';
    return cover ? toAbsoluteUrl(baseUrl, cover) : undefined;
}
function sanitizeNextAiringEpisode(value) {
    const normalized = normalizeText(value);
    if (!normalized) {
        return null;
    }
    if (/ya lo ire subiendo/i.test(normalized)) {
        return null;
    }
    return normalized;
}
function parseRelatedAnime(html, baseUrl) {
    const relatedBlock = html.match(/<h2><i class="icon fas fa-burn icon-yellow"><\/i>Relacionados<\/h2>[\s\S]*?<div class="articulos[^"]*">([\s\S]*?)<\/div>\s*<\/div>\s*<div id="animes-right-side">/i)?.[1] ?? '';
    const related = [];
    for (const match of relatedBlock.matchAll(/<a href="([^"]+)">([\s\S]*?)<\/a>/gi)) {
        const [, href = '', block = ''] = match;
        const slug = href ? extractSeriesSlug(baseUrl, href) : '';
        const cover = block.match(/<img loading="lazy" class="skeleton" src="([^"]+)"/i)?.[1] ?? '';
        const title = normalizeText(block.match(/<h3>([\s\S]*?)<\/h3>/i)?.[1] ?? '');
        if (!href || !slug || !title) {
            continue;
        }
        related.push({
            title,
            relation: 'Relacionado',
            slug,
            cover: cover ? toAbsoluteUrl(baseUrl, cover) : undefined,
            url: toAbsoluteUrl(baseUrl, href),
        });
    }
    return related;
}
function normalizeServerKey(value) {
    return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}
function parseDownloadMap(html, baseUrl) {
    const block = html.match(/<div class="descargas" id="dropdown-descargas">([\s\S]*?)<\/div>/i)?.[1] ?? '';
    const downloads = new Map();
    for (const match of block.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
        const [, href = '', rawLabel = ''] = match;
        const label = normalizeText(rawLabel).replace(/\s+[^\s]+$/, '').trim();
        if (!href || !label) {
            continue;
        }
        downloads.set(normalizeServerKey(label), toAbsoluteUrl(baseUrl, href));
    }
    return downloads;
}
function parseEpisodeServers(html, baseUrl) {
    const downloadMap = parseDownloadMap(html, baseUrl);
    const servers = [];
    for (const match of html.matchAll(/<button[^>]+class="[^"]*btn-embed[^"]*"[^>]+data-url="([^"]+)"[^>]*>([\s\S]*?)<\/button>/gi)) {
        const [, rawEmbed = '', rawLabel = ''] = match;
        const name = normalizeText(rawLabel);
        if (!rawEmbed || !name) {
            continue;
        }
        servers.push({
            name,
            embed: toAbsoluteUrl(baseUrl, rawEmbed),
            download: downloadMap.get(normalizeServerKey(name)) ?? null,
        });
    }
    return servers;
}
export function createAnimeMovilProvider(baseUrl = DEFAULT_ANIMEMOVIL_BASE_URL) {
    const normalizedBaseUrl = trimTrailingSlash(baseUrl) || DEFAULT_ANIMEMOVIL_BASE_URL;
    const detailCache = new Map();
    async function fetchAnimeDetail(slug, signal) {
        const cached = detailCache.get(slug);
        if (cached) {
            return cached;
        }
        const html = await requestAnimeMovilText(normalizedBaseUrl, `/${slug}`, signal);
        const title = normalizeText(html.match(/<div class="titles">[\s\S]*?<h1>([\s\S]*?)<\/h1>/i)?.[1] ?? '') ||
            normalizeText(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '');
        if (!title) {
            throw new ApiError('No pude leer el detalle de AnimeMovil.', 502);
        }
        const type = normalizeType(html.match(/id="show-data"[\s\S]*?<span class="item bl">([\s\S]*?)<\/span>/i)?.[1] ?? '');
        const status = normalizeText(html.match(/<span class="estado[^"]*">([\s\S]*?)<\/span>/i)?.[1] ??
            html.match(/<div class="figure-title">\s*<p class="gray">([\s\S]*?)<\/p>/i)?.[1] ??
            '');
        const synopsis = normalizeText(html.match(/id="sinopsis">([\s\S]*?)<\/p>/i)?.[1] ?? '');
        const genresBlock = html.match(/<div class="generos-wrap">([\s\S]*?)<\/div>/i)?.[1] ?? '';
        const genres = Array.from(genresBlock.matchAll(/<a class="item br"[^>]*>([\s\S]*?)<\/a>/gi))
            .map((match) => normalizeText(match[1] ?? ''))
            .filter(Boolean);
        const nextAiringEpisode = sanitizeNextAiringEpisode(html.match(/<div class="prox-episodio">[\s\S]*?<span>([\s\S]*?)<\/span>/i)?.[1] ?? '');
        const episodeListHtml = html.match(/<ul id="eps">([\s\S]*?)<\/ul>/i)?.[1] ?? '';
        const episodes = [];
        for (const match of episodeListHtml.matchAll(/<a href="([^"]*\/ver\/[^"]+)"/gi)) {
            const href = match[1] ?? '';
            const episodeSlug = extractEpisodeSlug(normalizedBaseUrl, href);
            const number = extractLastNumber(episodeSlug);
            if (!href || !episodeSlug || !number) {
                continue;
            }
            episodes.push({
                number,
                slug: episodeSlug,
                routeParam: String(number),
                url: toAbsoluteUrl(normalizedBaseUrl, href),
            });
        }
        const detail = {
            title,
            slug,
            type: type || 'tv',
            cover: parseCover(html, normalizedBaseUrl),
            synopsis: synopsis || undefined,
            alternativeTitles: [],
            status: status || 'Sin estado',
            genres,
            nextAiringEpisode,
            episodes: normalizeEpisodeLinks(episodes),
            related: parseRelatedAnime(html, normalizedBaseUrl),
            url: buildSeriesUrl(normalizedBaseUrl, slug),
        };
        detailCache.set(slug, detail);
        return detail;
    }
    return {
        key: 'animemovil',
        label: 'AnimeMovil Scraper',
        async getLatestEpisodes(signal) {
            const html = await requestAnimeMovilText(normalizedBaseUrl, '/', signal);
            return parseLatestEpisodes(html, normalizedBaseUrl);
        },
        async getOnAir(signal) {
            const html = await requestAnimeMovilText(normalizedBaseUrl, '/directorio/?estado=2', signal);
            return parseDirectoryCards(html, normalizedBaseUrl).map((card) => ({
                title: card.title,
                slug: card.slug,
                type: card.type,
                cover: card.cover,
                synopsis: [card.status, card.year].filter(Boolean).join(' • ') || undefined,
                url: card.url,
            }));
        },
        async search(params, signal) {
            const hasFilters = params.genres.length > 0 || params.statuses.length > 0 || params.types.length > 0;
            const query = params.query.trim();
            if (!query && !hasFilters) {
                return {
                    currentPage: 1,
                    hasNextPage: false,
                    previousPage: null,
                    nextPage: null,
                    foundPages: 0,
                    media: [],
                    mode: 'filter',
                };
            }
            const html = await requestAnimeMovilText(normalizedBaseUrl, buildDirectoryUrl(normalizedBaseUrl, params), signal);
            return parseDirectoryPage(html, normalizedBaseUrl, normalizePaginationValue(params.page), query ? 'text' : 'filter');
        },
        async getAnimeBySlug(slug, signal) {
            return fetchAnimeDetail(slug, signal);
        },
        async getEpisodeByNumber(animeSlug, episodeNumber, signal) {
            const html = await requestAnimeMovilText(normalizedBaseUrl, buildEpisodeUrl(normalizedBaseUrl, animeSlug, episodeNumber), signal);
            const detail = await fetchAnimeDetail(animeSlug, signal).catch(() => null);
            const title = normalizeText(html.match(/<div class="titulo-episodio">[\s\S]*?<h1>([\s\S]*?)<\/h1>/i)?.[1] ?? '') ||
                `${detail?.title ?? animeSlug} - Episodio ${episodeNumber}`;
            const servers = parseEpisodeServers(html, normalizedBaseUrl);
            if (servers.length === 0) {
                throw new ApiError('AnimeMovil no devolvio servidores para este episodio.', 502);
            }
            return {
                animeSlug,
                title,
                number: episodeNumber,
                routeParam: String(episodeNumber),
                servers,
            };
        },
    };
}
