import { ApiError, requestText } from '../lib/http.js';
const OLYMPUS_BASE_URL = 'https://olympusbiblioteca.com';
const OLYMPUS_DASHBOARD_BASE_URL = 'https://dashboard.olympusbiblioteca.com';
const OLYMPUS_NOTICE = 'Olympus integrado desde la API publica del sitio. La lectura usa el endpoint real de capitulos para evitar hojas incompletas.';
const OLYMPUS_HEADERS = {
    Accept: 'application/json, text/plain, */*',
    Referer: `${OLYMPUS_BASE_URL}/`,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
};
const OLYMPUS_HTML_HEADERS = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    Referer: `${OLYMPUS_BASE_URL}/`,
    'User-Agent': OLYMPUS_HEADERS['User-Agent'],
};
const CACHE_TTL_MS = 5 * 60 * 1000;
const FULL_CATALOG_TTL_MS = 10 * 60 * 1000;
const FULL_CATALOG_BATCH_SIZE = 6;
const CHAPTERS_BATCH_SIZE = 4;
const seriesPageCache = new Map();
const seriesDetailCache = new Map();
const seriesChaptersCache = new Map();
let recentSeriesCache = null;
let fullCatalogCache = null;
function getCacheValue(entry) {
    if (!entry) {
        return null;
    }
    if (entry.expiresAt <= Date.now()) {
        return null;
    }
    return entry.value;
}
function setCacheValue(value, ttlMs = CACHE_TTL_MS) {
    return {
        expiresAt: Date.now() + ttlMs,
        value,
    };
}
function normalizeWhitespace(value) {
    return value.replace(/\s+/g, ' ').trim();
}
function readText(value) {
    return typeof value === 'string' && value.trim() ? normalizeWhitespace(value) : null;
}
function readName(value) {
    if (typeof value === 'string') {
        return value.trim() || null;
    }
    if (value && typeof value === 'object' && 'name' in value) {
        return readText(value.name);
    }
    return null;
}
function readNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function toIdString(value) {
    const text = String(value ?? '').trim();
    return text || '0';
}
function ensureUrlPath(value) {
    return value.startsWith('/') ? value : `/${value}`;
}
function buildSiteUrl(path) {
    return new URL(ensureUrlPath(path), OLYMPUS_BASE_URL).toString();
}
function buildOlympusSourceUrl(slug) {
    return buildSiteUrl(`/series/comic-${slug}`);
}
function buildOlympusChapterUrl(slug, chapterId) {
    return buildSiteUrl(`/capitulo/${chapterId}/comic-${slug}`);
}
function decodeHtmlAttribute(value) {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}
function buildOlympusSynopsis(summary) {
    const normalized = normalizeWhitespace(summary ?? '');
    if (!normalized) {
        return 'Abre la ficha para cargar la sinopsis real desde Olympus.';
    }
    return normalized.length > 260 ? `${normalized.slice(0, 260).trim()}...` : normalized;
}
function padChapterNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? String(parsed).padStart(2, '0') : value;
}
function chapterSortValue(value, id) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
        return parsed;
    }
    return Number(id) || Number.MAX_SAFE_INTEGER;
}
function dedupeSummaries(items) {
    const unique = new Map();
    for (const item of items) {
        unique.set(`${item.libraryType}:${item.id}:${item.slug}`, item);
    }
    return Array.from(unique.values());
}
function dedupeRecentChapters(items) {
    const unique = new Map();
    for (const item of items) {
        if (!unique.has(item.mangaId)) {
            unique.set(item.mangaId, item);
        }
    }
    return Array.from(unique.values());
}
function mapOlympusSeriesToSummary(series) {
    const id = toIdString(series.id);
    const title = normalizeWhitespace(series.name);
    const chapterCount = readNumber(series.chapter_count);
    return {
        id,
        slug: series.slug,
        libraryType: 'comic',
        title,
        cover: readText(series.cover) ?? '',
        synopsis: 'Abre la ficha para cargar la sinopsis real desde Olympus.',
        status: readName(series.status) ?? 'Sin estado',
        demography: 'Comic',
        rating: '',
        genres: [],
        chapterCount,
        sourceUrl: buildOlympusSourceUrl(series.slug),
        source: 'olympus',
    };
}
function mapOlympusDetailToSummary(detail) {
    return {
        id: toIdString(detail.id),
        slug: detail.slug,
        libraryType: 'comic',
        title: normalizeWhitespace(detail.name),
        cover: readText(detail.cover) ?? '',
        synopsis: buildOlympusSynopsis(detail.summary),
        status: readName(detail.status) ?? 'Sin estado',
        demography: detail.genres?.[0] ? normalizeWhitespace(detail.genres[0].name) : 'Comic',
        rating: String(readNumber(detail.like_count || detail.view_count)),
        genres: (detail.genres ?? [])
            .map((genre) => readText(genre.name))
            .filter((genre) => Boolean(genre)),
        chapterCount: readNumber(detail.chapter_count),
        sourceUrl: buildOlympusSourceUrl(detail.slug),
        source: 'olympus',
    };
}
function createOlympusChapterSummary(manga, chapter) {
    const id = toIdString(chapter.id);
    const number = normalizeWhitespace(chapter.name);
    return {
        id,
        slug: `chapter-${id}`,
        title: `${manga.title} - Capitulo ${number}`,
        numberLabel: `Capitulo ${padChapterNumber(number)}`,
        shortTitle: `Capitulo ${number}`,
        cover: manga.cover,
        sourceUrl: buildOlympusChapterUrl(manga.slug, id),
    };
}
function mapRecommendedSeries(value) {
    let parsed = [];
    if (typeof value === 'string' && value.trim()) {
        try {
            parsed = JSON.parse(value);
        }
        catch {
            parsed = [];
        }
    }
    else if (Array.isArray(value)) {
        parsed = value;
    }
    return dedupeSummaries(parsed.map((item) => mapOlympusSeriesToSummary(item)));
}
async function requestOlympusJson(path, searchParams, signal) {
    const url = new URL(path, OLYMPUS_DASHBOARD_BASE_URL);
    for (const [key, value] of Object.entries(searchParams)) {
        if (value !== undefined && value !== null && `${value}`.trim()) {
            url.searchParams.set(key, String(value));
        }
    }
    const response = await fetch(url, {
        headers: OLYMPUS_HEADERS,
        signal,
    });
    if (!response.ok) {
        let message = response.statusText || 'Olympus respondio con un error.';
        try {
            const payload = (await response.json());
            if (payload.message) {
                message = payload.message;
            }
        }
        catch {
            // noop
        }
        throw new ApiError(message, response.status);
    }
    return (await response.json());
}
async function getOlympusSeriesPage(page = 1, signal) {
    const cacheKey = `series-page:${page}`;
    const cached = getCacheValue(seriesPageCache.get(cacheKey));
    if (cached) {
        return cached;
    }
    const payload = await requestOlympusJson('/api/series', {
        page,
        direction: 'desc',
        type: 'comic',
    }, signal);
    const value = {
        items: payload.data.series.data.map((item) => mapOlympusSeriesToSummary(item)),
        recommended: mapRecommendedSeries(payload.data.recommended_series),
        currentPage: payload.data.series.current_page,
        lastPage: payload.data.series.last_page,
        total: payload.data.series.total,
    };
    seriesPageCache.set(cacheKey, setCacheValue(value));
    return value;
}
async function getOlympusSeriesDetailRaw(slug, signal) {
    const cacheKey = `series-detail:${slug}`;
    const cached = getCacheValue(seriesDetailCache.get(cacheKey));
    if (cached) {
        return cached;
    }
    const payload = await requestOlympusJson(`/api/series/${encodeURIComponent(slug)}`, { type: 'comic' }, signal);
    seriesDetailCache.set(cacheKey, setCacheValue(payload.data));
    return payload.data;
}
async function getOlympusSeriesChaptersPage(slug, page, signal) {
    return requestOlympusJson(`/api/series/${encodeURIComponent(slug)}/chapters`, {
        page,
        direction: 'desc',
        type: 'comic',
    }, signal);
}
async function getOlympusAllSeriesChapters(manga, signal) {
    const cacheKey = `series-chapters:${manga.slug}`;
    const cached = getCacheValue(seriesChaptersCache.get(cacheKey));
    if (cached) {
        return cached;
    }
    const firstPage = await getOlympusSeriesChaptersPage(manga.slug, 1, signal);
    const rawChapters = [...firstPage.data];
    if (firstPage.meta.last_page > 1) {
        for (let start = 2; start <= firstPage.meta.last_page; start += CHAPTERS_BATCH_SIZE) {
            if (signal?.aborted) {
                throw new ApiError('La solicitud fue cancelada.', 499);
            }
            const batchPages = Array.from({ length: Math.min(CHAPTERS_BATCH_SIZE, firstPage.meta.last_page - start + 1) }, (_, index) => start + index);
            const batch = await Promise.all(batchPages.map((page) => getOlympusSeriesChaptersPage(manga.slug, page, signal)));
            for (const page of batch) {
                rawChapters.push(...page.data);
            }
        }
    }
    const chapters = rawChapters
        .map((chapter) => createOlympusChapterSummary(manga, chapter))
        .sort((left, right) => {
        return (chapterSortValue(left.shortTitle.replace(/^Capitulo\s+/i, ''), left.id) -
            chapterSortValue(right.shortTitle.replace(/^Capitulo\s+/i, ''), right.id));
    });
    seriesChaptersCache.set(cacheKey, setCacheValue(chapters));
    return chapters;
}
function extractMangaIdFromCover(cover, fallbackSlug) {
    const match = cover.match(/\/storage\/comics\/covers\/(\d+)\//i);
    return match?.[1] ?? fallbackSlug;
}
function parseRecentChapterGroups(html) {
    const groups = html
        .split('<div class="bg-gray-800 p-4 rounded-xl relative">')
        .slice(1)
        .map((chunk) => {
        const seriesMatch = chunk.match(/href="\/series\/comic-([^"]+)"[\s\S]*?src="([^"]+)"[\s\S]*?alt="([^"]+)"/i);
        if (!seriesMatch) {
            return null;
        }
        const [, slug, rawCover, title] = seriesMatch;
        const cover = decodeHtmlAttribute(rawCover);
        const mangaId = extractMangaIdFromCover(cover, slug);
        const manga = {
            id: mangaId,
            slug,
            libraryType: 'comic',
            title: normalizeWhitespace(title),
            cover,
            synopsis: 'Abre la ficha para cargar la sinopsis real desde Olympus.',
            status: 'Sin estado',
            demography: 'Comic',
            rating: '',
            genres: [],
            chapterCount: 0,
            sourceUrl: buildOlympusSourceUrl(slug),
            source: 'olympus',
        };
        const chapterPattern = /href="\/capitulo\/(\d+)\/comic-[^"]+"[\s\S]*?<div class="chapter-name[^"]*"[^>]*>\s*Capítulo\s*([^<]+)<\/div>[\s\S]*?<time datetime="([^"]+)"[^>]*>([^<]+)<\/time>/gi;
        const chapters = [];
        let match;
        while ((match = chapterPattern.exec(chunk))) {
            const [, chapterId, chapterNumber, , relativeTime] = match;
            const cleanNumber = normalizeWhitespace(chapterNumber);
            chapters.push({
                mangaId,
                mangaSlug: slug,
                mangaTitle: manga.title,
                libraryType: 'comic',
                chapterId,
                chapterSlug: `chapter-${chapterId}`,
                chapterTitle: normalizeWhitespace(relativeTime),
                numberLabel: `Capitulo ${padChapterNumber(cleanNumber)}`,
                cover,
                sourceUrl: buildOlympusChapterUrl(slug, chapterId),
            });
        }
        if (chapters.length === 0) {
            return null;
        }
        return {
            manga,
            chapters,
        };
    })
        .filter((group) => Boolean(group));
    return groups;
}
async function getOlympusRecentChapterGroups(signal) {
    const cached = getCacheValue(recentSeriesCache);
    if (cached) {
        return cached;
    }
    const response = await requestText(`${OLYMPUS_BASE_URL}/capitulos`, signal, {
        headers: OLYMPUS_HTML_HEADERS,
    });
    const groups = parseRecentChapterGroups(response.bodyText);
    recentSeriesCache = setCacheValue(groups);
    return groups;
}
async function getOlympusFullCatalog(signal) {
    const cached = getCacheValue(fullCatalogCache);
    if (cached) {
        return cached;
    }
    const firstPage = await getOlympusSeriesPage(1, signal);
    const items = [...firstPage.items];
    if (firstPage.lastPage > 1) {
        for (let start = 2; start <= firstPage.lastPage; start += FULL_CATALOG_BATCH_SIZE) {
            if (signal?.aborted) {
                throw new ApiError('La solicitud fue cancelada.', 499);
            }
            const batchPages = Array.from({ length: Math.min(FULL_CATALOG_BATCH_SIZE, firstPage.lastPage - start + 1) }, (_, index) => start + index);
            const batch = await Promise.all(batchPages.map((page) => getOlympusSeriesPage(page, signal)));
            for (const page of batch) {
                items.push(...page.items);
            }
        }
    }
    const deduped = dedupeSummaries(items);
    fullCatalogCache = setCacheValue(deduped, FULL_CATALOG_TTL_MS);
    return deduped;
}
export function isOlympusMangaLibrary(libraryType) {
    return libraryType.trim().toLowerCase() === 'comic';
}
export async function getOlympusMangaHome(signal) {
    const [seriesPage, recentGroups] = await Promise.all([
        getOlympusSeriesPage(1, signal),
        getOlympusRecentChapterGroups(signal),
    ]);
    const featuredSeed = recentGroups[0]?.manga ?? seriesPage.items[0];
    if (!featuredSeed) {
        throw new ApiError('Olympus no devolvio series para la portada.', 502);
    }
    const featuredDetail = await getOlympusSeriesDetailRaw(featuredSeed.slug, signal);
    const featured = mapOlympusDetailToSummary(featuredDetail);
    const fallbackPage = seriesPage.lastPage > 1 && (seriesPage.items.length < 18 || seriesPage.recommended.length < 12)
        ? await getOlympusSeriesPage(2, signal)
        : null;
    const recentChapters = dedupeRecentChapters(recentGroups.flatMap((group) => group.chapters)).slice(0, 18);
    const trending = dedupeSummaries([
        featured,
        ...seriesPage.items.filter((item) => item.slug !== featured.slug),
        ...(fallbackPage?.items ?? []).filter((item) => item.slug !== featured.slug),
    ]).slice(0, 18);
    const spotlight = dedupeSummaries([
        ...seriesPage.recommended,
        ...(fallbackPage?.recommended ?? []),
        ...seriesPage.items,
        ...(fallbackPage?.items ?? []),
    ])
        .filter((item) => item.slug !== featured.slug)
        .slice(0, 12);
    return {
        featured,
        trending,
        latestChapters: recentChapters,
        spotlight,
        source: 'olympus',
        notice: OLYMPUS_NOTICE,
    };
}
export async function searchOlympusManga(query, signal) {
    const cleanQuery = query.trim().toLowerCase();
    if (!cleanQuery) {
        const preview = await getOlympusSeriesPage(1, signal);
        return dedupeSummaries(preview.items).slice(0, 24);
    }
    const catalog = await getOlympusFullCatalog(signal);
    return catalog.filter((manga) => {
        return (manga.title.toLowerCase().includes(cleanQuery) ||
            manga.slug.toLowerCase().includes(cleanQuery) ||
            manga.synopsis.toLowerCase().includes(cleanQuery));
    });
}
export async function getOlympusMangaDetail(libraryType, id, slug, signal) {
    if (!isOlympusMangaLibrary(libraryType)) {
        throw new ApiError('La serie no pertenece a Olympus.', 404);
    }
    const [detailRaw, seriesPage] = await Promise.all([
        getOlympusSeriesDetailRaw(slug, signal),
        getOlympusSeriesPage(1, signal),
    ]);
    const summary = mapOlympusDetailToSummary(detailRaw);
    if (toIdString(detailRaw.id) !== id.trim()) {
        throw new ApiError('La serie solicitada no coincide con Olympus.', 404);
    }
    const chapters = await getOlympusAllSeriesChapters(summary, signal);
    const related = dedupeSummaries(seriesPage.recommended.filter((item) => item.id !== summary.id)).slice(0, 8);
    return {
        ...summary,
        description: buildOlympusSynopsis(detailRaw.summary),
        alternativeTitles: detailRaw.note ? [normalizeWhitespace(detailRaw.note)] : [],
        chapters,
        related,
        notice: OLYMPUS_NOTICE,
    };
}
export async function getOlympusMangaReadData(libraryType, id, slug, chapterId, signal) {
    if (!isOlympusMangaLibrary(libraryType)) {
        throw new ApiError('La serie no pertenece a Olympus.', 404);
    }
    const detailRaw = await getOlympusSeriesDetailRaw(slug, signal);
    const summary = mapOlympusDetailToSummary(detailRaw);
    if (toIdString(detailRaw.id) !== id.trim()) {
        throw new ApiError('La serie solicitada no coincide con Olympus.', 404);
    }
    const [chapters, chapterData] = await Promise.all([
        getOlympusAllSeriesChapters(summary, signal),
        getOlympusChapterData({
            chapterId,
            slug,
            type: 'comic',
        }, signal),
    ]);
    const currentChapter = chapters.find((chapter) => chapter.id === chapterId.trim()) ??
        createOlympusChapterSummary(summary, {
            id: chapterData.chapter.id,
            name: chapterData.chapter.number,
        });
    return {
        manga: summary,
        chapter: currentChapter,
        chapters,
        pages: chapterData.chapter.pages,
        readingMode: chapterData.chapter.pages.length > 0 ? 'pages' : 'external',
        externalUrl: chapterData.chapterUrl,
        source: 'olympus',
        notice: OLYMPUS_NOTICE,
    };
}
function isNuxtRef(value, payload) {
    return Number.isInteger(value) && Number(value) >= 0 && Number(value) < payload.length;
}
function resolveNuxtValue(payload, value, stack = new Set()) {
    if (isNuxtRef(value, payload)) {
        const ref = Number(value);
        if (stack.has(ref)) {
            return payload[ref];
        }
        const target = payload[ref];
        if (target === null || typeof target !== 'object') {
            return target;
        }
        const nextStack = new Set(stack);
        nextStack.add(ref);
        return resolveNuxtValue(payload, target, nextStack);
    }
    if (Array.isArray(value)) {
        const [tag, next] = value;
        if ((tag === 'ShallowReactive' || tag === 'Reactive' || tag === 'Ref') &&
            value.length >= 2) {
            return resolveNuxtValue(payload, next, stack);
        }
        return value.map((item) => resolveNuxtValue(payload, item, stack));
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [
            key,
            resolveNuxtValue(payload, nestedValue, stack),
        ]));
    }
    return value;
}
function getChapterTarget(options) {
    const requestedType = options.type?.trim() || 'comic';
    if (options.chapterId?.trim() && options.slug?.trim()) {
        const chapterId = options.chapterId.trim();
        const slug = options.slug.trim();
        const chapterUrl = buildOlympusChapterUrl(slug, chapterId);
        const apiUrl = new URL(`/api/capitulo/${slug}/${chapterId}`, OLYMPUS_BASE_URL);
        apiUrl.searchParams.set('type', requestedType);
        return {
            chapterId,
            slug,
            type: requestedType,
            chapterUrl,
            apiUrl: apiUrl.toString(),
        };
    }
    const rawUrl = options.chapterUrl?.trim() || options.payloadUrl?.trim();
    if (!rawUrl) {
        throw new ApiError('Debes enviar payloadUrl, chapterUrl o chapterId + slug para consultar Olympus.', 400);
    }
    const parsed = new URL(rawUrl);
    const pathname = parsed.pathname.replace(/\/_payload\.json$/, '').replace(/\/$/, '');
    const match = pathname.match(/^\/capitulo\/([^/]+)\/([^/]+)$/i);
    if (!match) {
        throw new ApiError('La ruta del capitulo de Olympus no es valida.', 400);
    }
    const [, chapterId, routeSlug] = match;
    let type = requestedType;
    let slug = routeSlug;
    const routeMatch = routeSlug.match(/^([a-z]+)-(.+)$/i);
    if (routeMatch) {
        const [, detectedType, detectedSlug] = routeMatch;
        if (!options.type?.trim()) {
            type = detectedType.toLowerCase();
        }
        if (detectedType.toLowerCase() === type.toLowerCase()) {
            slug = detectedSlug;
        }
    }
    const chapterUrl = buildSiteUrl(pathname);
    const apiUrl = new URL(`/api/capitulo/${slug}/${chapterId}`, OLYMPUS_BASE_URL);
    apiUrl.searchParams.set('type', type);
    return {
        chapterId,
        slug,
        type,
        chapterUrl,
        apiUrl: apiUrl.toString(),
    };
}
async function requestOlympusSiteJson(url, signal) {
    const response = await fetch(url, {
        headers: OLYMPUS_HEADERS,
        signal,
    });
    if (!response.ok) {
        let message = response.statusText || 'Olympus respondio con un error.';
        try {
            const payload = (await response.json());
            if (payload.message) {
                message = payload.message;
            }
        }
        catch {
            // noop
        }
        throw new ApiError(message, response.status);
    }
    return (await response.json());
}
function buildSeriesRouteSlug(type, seriesSlug) {
    if (!seriesSlug) {
        return null;
    }
    if (!type) {
        return seriesSlug;
    }
    return seriesSlug.startsWith(`${type}-`) ? seriesSlug : `${type}-${seriesSlug}`;
}
export async function getOlympusChapterData(options, signal) {
    const target = getChapterTarget(options);
    const payload = await requestOlympusSiteJson(target.apiUrl, signal);
    const chapter = payload.chapter ?? null;
    const comic = payload.comic ?? null;
    const prevChapter = payload.prev_chapter ?? null;
    const nextChapter = payload.next_chapter ?? null;
    if (!chapter) {
        throw new ApiError('Olympus no devolvio la informacion del capitulo.', 502);
    }
    let recommendedSeries = [];
    if (Array.isArray(chapter.recommended_series)) {
        recommendedSeries = chapter.recommended_series;
    }
    else if (typeof chapter.recommended_series === 'string' && chapter.recommended_series.trim()) {
        try {
            recommendedSeries = JSON.parse(chapter.recommended_series);
        }
        catch {
            recommendedSeries = [];
        }
    }
    const chapterType = readText(chapter.type) ?? target.type;
    const seriesSlug = readText(comic?.slug) ?? target.slug;
    const seriesName = readText(comic?.name);
    const seriesRouteSlug = buildSeriesRouteSlug(chapterType, seriesSlug);
    const chapterTitle = readText(chapter.title) ?? readText(chapter.name);
    const chapterNumber = readText(chapter.name) ?? '0';
    const pages = Array.isArray(chapter.pages)
        ? chapter.pages
            .map((page) => readText(page))
            .filter((pageUrl) => Boolean(pageUrl))
        : [];
    return {
        source: 'olympus',
        payloadUrl: target.apiUrl,
        routePath: new URL(target.chapterUrl).pathname,
        chapterUrl: target.chapterUrl,
        chapter: {
            id: chapter.id ?? '',
            number: chapterNumber,
            title: chapterTitle,
            publishedAt: readText(chapter.published_at),
            viewCount: readNumber(chapter.view_count),
            type: chapterType,
            pageCount: pages.length,
            pages,
            team: chapter.team && typeof chapter.team === 'object'
                ? (() => {
                    const team = chapter.team;
                    return {
                        id: team.id ?? '',
                        name: readName(team.name) ?? 'Equipo desconocido',
                        cover: readText(team.cover),
                    };
                })()
                : null,
        },
        series: comic && seriesSlug && seriesName
            ? {
                id: comic.id ?? '',
                name: seriesName,
                slug: seriesSlug,
                url: buildSiteUrl(`/series/${seriesRouteSlug}`),
            }
            : null,
        prevChapter: prevChapter && seriesRouteSlug
            ? {
                id: prevChapter.id ?? '',
                number: readText(prevChapter.name) ?? '',
                url: buildSiteUrl(`/capitulo/${String(prevChapter.id ?? '').trim()}/${seriesRouteSlug}`),
            }
            : null,
        nextChapter: nextChapter && seriesRouteSlug
            ? {
                id: nextChapter.id ?? '',
                number: readText(nextChapter.name) ?? '',
                url: buildSiteUrl(`/capitulo/${String(nextChapter.id ?? '').trim()}/${seriesRouteSlug}`),
            }
            : null,
        recommendedSeries: recommendedSeries
            .map((item) => {
            if (!item || typeof item !== 'object') {
                return null;
            }
            const candidate = item;
            const recommendedSlug = readText(candidate.slug);
            const recommendedType = readText(candidate.type);
            const recommendedName = readText(candidate.name);
            if (!recommendedSlug || !recommendedName) {
                return null;
            }
            return {
                id: candidate.id ?? '',
                name: recommendedName,
                slug: recommendedSlug,
                status: readName(candidate.status),
                cover: readText(candidate.cover),
                type: recommendedType,
                url: buildSiteUrl(`/series/${buildSeriesRouteSlug(recommendedType, recommendedSlug) ?? recommendedSlug}`),
            };
        })
            .filter((item) => Boolean(item)),
    };
}
