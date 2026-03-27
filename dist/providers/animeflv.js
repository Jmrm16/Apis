import { requestJson, requestText } from '../lib/http.js';
const ANIMEFLV_SITE_BASE_URL = 'https://www3.animeflv.net';
const BROWSER_HEADERS = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
};
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
function toAbsoluteUrl(baseUrl, value) {
    return new URL(value, baseUrl).toString();
}
function extractAnimeSlugFromEpisodeSlug(episodeSlug, number) {
    const suffix = `-${number}`;
    if (episodeSlug.endsWith(suffix)) {
        return episodeSlug.slice(0, -suffix.length);
    }
    return episodeSlug;
}
function extractSeriesSlug(value) {
    return value.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/anime\//, '').replace(/^\/+|\/+$/g, '');
}
function normalizeAnimeFlvType(value) {
    const normalized = normalizeText(value).toLowerCase();
    switch (normalized) {
        case 'anime':
        case 'tv':
            return 'tv';
        case 'pelicula':
        case 'película':
        case 'movie':
            return 'movie';
        case 'especial':
        case 'special':
            return 'special';
        case 'ova':
            return 'ova';
        default:
            return normalized || 'tv';
    }
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
function mapAnimeFlvSummary(item) {
    return {
        title: item.title,
        slug: item.slug,
        type: item.type,
        url: item.url,
    };
}
function mapSearchItem(item) {
    return {
        title: item.title,
        slug: item.slug,
        type: item.type,
        cover: item.cover,
        synopsis: item.synopsis,
        rating: item.rating,
        url: item.url,
    };
}
function buildBrowseUrl(params) {
    const url = new URL('/browse', ANIMEFLV_SITE_BASE_URL);
    for (const genre of params.genres) {
        url.searchParams.append('genre[]', genre);
    }
    for (const type of params.types) {
        url.searchParams.append('type[]', type);
    }
    for (const status of params.statuses) {
        url.searchParams.append('status[]', String(status));
    }
    if (params.order !== 'default') {
        url.searchParams.set('order', params.order);
    }
    if (params.page > 1) {
        url.searchParams.set('page', String(params.page));
    }
    return url.toString();
}
function parseBrowseCards(html) {
    const listHtml = html.match(/<ul class="ListAnimes[^"]*">([\s\S]*?)<\/ul>/i)?.[1] ?? '';
    const cards = [];
    for (const match of listHtml.matchAll(/<article class="Anime alt B">([\s\S]*?)<\/article>/gi)) {
        const block = match[1] ?? '';
        const href = block.match(/<a href="([^"]*\/anime\/[^"]+)"/i)?.[1] ?? '';
        const title = normalizeText(block.match(/<h3 class="Title">([\s\S]*?)<\/h3>/i)?.[1] ?? '');
        const cover = block.match(/<figure><img src="([^"]+)"/i)?.[1] ?? '';
        const typeLabel = normalizeText(block.match(/<span class="Type[^>]*">([\s\S]*?)<\/span>/i)?.[1] ?? '');
        const rating = normalizeText(block.match(/<span class="Vts fa-star">([\s\S]*?)<\/span>/i)?.[1] ?? '');
        const descriptionBlock = block.match(/<div class="Description">([\s\S]*?)<\/div>/i)?.[1] ?? '';
        const paragraphs = Array.from(descriptionBlock.matchAll(/<p>([\s\S]*?)<\/p>/gi))
            .map((entry) => normalizeText(entry[1] ?? ''))
            .filter(Boolean);
        const synopsis = paragraphs[1] ?? '';
        const slug = href ? extractSeriesSlug(href) : '';
        if (!href || !slug || !title) {
            continue;
        }
        cards.push({
            title,
            slug,
            type: normalizeAnimeFlvType(typeLabel),
            cover: cover ? toAbsoluteUrl(ANIMEFLV_SITE_BASE_URL, cover) : undefined,
            synopsis: synopsis || undefined,
            rating: rating || undefined,
            url: toAbsoluteUrl(ANIMEFLV_SITE_BASE_URL, href),
        });
    }
    return cards;
}
function parseBrowseResult(html, requestedPage) {
    const cards = parseBrowseCards(html);
    const paginationHtml = html.match(/<ul class="pagination">([\s\S]*?)<\/ul>/i)?.[1] ?? '';
    const pageMatches = Array.from(paginationHtml.matchAll(/page=(\d+)/gi)).map((match) => Number(match[1]));
    const currentPage = Number(paginationHtml.match(/<li class="active"><a[^>]*>\s*(\d+)\s*<\/a><\/li>/i)?.[1] ?? '') ||
        requestedPage;
    const foundPages = Math.max(currentPage, requestedPage, 1, ...pageMatches);
    const hasNextPage = /rel="next"/i.test(paginationHtml);
    const hasPreviousPage = /rel="prev"/i.test(paginationHtml);
    return {
        currentPage,
        hasNextPage,
        previousPage: hasPreviousPage ? String(Math.max(1, currentPage - 1)) : null,
        nextPage: hasNextPage ? String(currentPage + 1) : null,
        foundPages,
        media: cards.map(mapSearchItem),
        mode: 'filter',
    };
}
export function createAnimeFlvProvider(baseUrl) {
    const detailCache = new Map();
    async function fetchAnimeDetail(slug, signal) {
        const cached = detailCache.get(slug);
        if (cached) {
            return cached;
        }
        const data = await requestJson(baseUrl, `/api/anime/${encodeURIComponent(slug)}`, signal);
        const detail = {
            title: data.title,
            slug,
            type: data.type,
            cover: data.cover,
            synopsis: data.synopsis,
            rating: data.rating,
            alternativeTitles: data.alternative_titles ?? [],
            status: data.status,
            genres: data.genres ?? [],
            nextAiringEpisode: data.next_airing_episode ?? null,
            episodes: normalizeEpisodeLinks(data.episodes ?? []),
            related: data.related ?? [],
            url: data.url,
        };
        detailCache.set(slug, detail);
        return detail;
    }
    async function enrichOnAirSummary(item, signal) {
        try {
            const detail = await fetchAnimeDetail(item.slug, signal);
            return {
                title: item.title,
                slug: item.slug,
                type: item.type,
                cover: detail.cover,
                synopsis: detail.synopsis,
                rating: detail.rating,
                url: item.url,
            };
        }
        catch {
            return mapAnimeFlvSummary(item);
        }
    }
    async function enrichRelatedAnime(item, signal) {
        try {
            const detail = await fetchAnimeDetail(item.slug, signal);
            return {
                ...item,
                cover: detail.cover,
            };
        }
        catch {
            return item;
        }
    }
    return {
        key: 'animeflv',
        label: 'AnimeFLV Adapter',
        async getLatestEpisodes(signal) {
            const data = await requestJson(baseUrl, '/api/list/latest-episodes', signal);
            return data.map((item) => ({
                title: item.title,
                animeSlug: extractAnimeSlugFromEpisodeSlug(item.slug, item.number),
                episodeSlug: item.slug,
                number: item.number,
                cover: item.cover,
                url: item.url,
            }));
        },
        async getOnAir(signal) {
            const data = await requestJson(baseUrl, '/api/list/animes-on-air', signal);
            return Promise.all(data.map((item) => enrichOnAirSummary(item, signal)));
        },
        async search(params, signal) {
            const query = params.query.trim();
            const hasFilters = params.genres.length > 0 || params.statuses.length > 0 || params.types.length > 0;
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
            if (query) {
                const searchParams = new URLSearchParams({
                    query,
                    page: String(params.page),
                });
                const data = await requestJson(baseUrl, `/api/search?${searchParams.toString()}`, signal);
                return {
                    ...data,
                    media: data.media.map(mapSearchItem),
                    mode: 'text',
                };
            }
            const searchParams = new URLSearchParams({
                page: String(params.page),
            });
            if (params.order !== 'default') {
                searchParams.set('order', params.order);
            }
            try {
                const data = await requestJson(baseUrl, `/api/search/by-filter?${searchParams.toString()}`, signal, {
                    method: 'POST',
                    body: JSON.stringify({
                        genres: params.genres,
                        statuses: params.statuses,
                        types: params.types,
                    }),
                });
                return {
                    ...data,
                    media: data.media.map(mapSearchItem),
                    mode: 'filter',
                };
            }
            catch {
                const response = await requestText(buildBrowseUrl(params), signal, {
                    headers: BROWSER_HEADERS,
                });
                return parseBrowseResult(response.bodyText, params.page);
            }
        },
        async getAnimeBySlug(slug, signal) {
            const detail = await fetchAnimeDetail(slug, signal);
            const related = await Promise.all(detail.related.map((item) => enrichRelatedAnime(item, signal)));
            return {
                ...detail,
                related,
            };
        },
        async getEpisodeByNumber(animeSlug, episodeNumber, signal) {
            const data = await requestJson(baseUrl, `/api/anime/${encodeURIComponent(animeSlug)}/episode/${episodeNumber}`, signal);
            return {
                animeSlug,
                title: data.title,
                number: data.number,
                servers: data.servers.map((server) => ({
                    name: server.name,
                    download: server.download ?? null,
                    embed: server.embed ?? null,
                })),
            };
        },
    };
}
