import { requestJson } from '../lib/http.js';
function extractAnimeSlugFromEpisodeSlug(episodeSlug, number) {
    const suffix = `-${number}`;
    if (episodeSlug.endsWith(suffix)) {
        return episodeSlug.slice(0, -suffix.length);
    }
    return episodeSlug;
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
