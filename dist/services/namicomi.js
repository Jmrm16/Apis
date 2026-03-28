import { ApiError } from '../lib/http.js';
const NAMICOMI_WEB_URL = 'https://namicomi.com';
const NAMICOMI_API_URL = 'https://api.namicomi.com';
const NAMICOMI_CDN_URL = 'https://uploads.namicomi.com';
const COVER_PLACEHOLDER = 'https://placehold.co/600x900/111111/7dd3fc?text=NamiComi';
const NAMICOMI_NOTICE = 'NamiComi integrado por backend para evitar bloqueos de CORS. Home, detalle y lectura se resuelven contra la API oficial del sitio.';
const NAMICOMI_READ_NOTICE = 'Lectura interna desde NamiComi. Las paginas se componen usando el metadata oficial del capitulo.';
const CACHE_TTL_MS = 5 * 60 * 1000;
const DETAIL_TTL_MS = 15 * 60 * 1000;
const HOME_TTL_MS = 5 * 60 * 1000;
const HOME_COLLECTION_LIMIT = 18;
const SPOTLIGHT_LIMIT = 12;
const RECENT_CHAPTER_LIMIT = 18;
const SEARCH_LIMIT = 24;
const CHAPTER_LIST_LIMIT = 200;
const PREFERRED_TEXT_LANGS = ['es-419', 'es', 'en', 'pt-br', 'fr', 'de', 'ja'];
const PREFERRED_TRANSLATED_LANGS = ['es-419', 'es', 'en'];
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';
let homeCache = null;
let recentCache = null;
const titleCache = new Map();
const collectionCache = new Map();
const chapterFeedCache = new Map();
function normalizeWhitespace(value) {
    return value.replace(/\s+/g, ' ').trim();
}
function readText(value) {
    return typeof value === 'string' && value.trim() ? normalizeWhitespace(value) : null;
}
function readNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function getCacheValue(entry) {
    if (!entry || entry.expiresAt <= Date.now()) {
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
function pickLocalizedText(value, preferredLanguages = PREFERRED_TEXT_LANGS) {
    if (!value) {
        return null;
    }
    for (const language of preferredLanguages) {
        const text = readText(value[language]);
        if (text) {
            return text;
        }
    }
    for (const text of Object.values(value)) {
        const normalized = readText(text);
        if (normalized) {
            return normalized;
        }
    }
    return null;
}
function dedupeCaseInsensitive(values) {
    const unique = new Map();
    for (const value of values) {
        const normalized = value.trim().toLowerCase();
        if (normalized && !unique.has(normalized)) {
            unique.set(normalized, value);
        }
    }
    return Array.from(unique.values());
}
function slugify(value) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 100);
}
function sanitizeDescription(value) {
    return normalizeWhitespace(value
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
        .replace(/\n+/g, ' '));
}
function buildSynopsis(value) {
    const description = pickLocalizedText(value);
    if (!description) {
        return 'Abre la ficha para cargar la descripcion real desde NamiComi.';
    }
    const clean = sanitizeDescription(description);
    return clean.length > 260 ? `${clean.slice(0, 260).trim()}...` : clean;
}
function buildDescription(value) {
    const description = pickLocalizedText(value);
    if (!description) {
        return 'NamiComi no devolvio una descripcion completa para esta obra.';
    }
    return sanitizeDescription(description);
}
function formatStatus(value) {
    switch ((value ?? '').trim().toLowerCase()) {
        case 'ongoing':
            return 'Publicandose';
        case 'completed':
            return 'Finalizado';
        case 'hiatus':
            return 'En pausa';
        case 'cancelled':
            return 'Cancelado';
        default:
            return 'Sin estado';
    }
}
function mapTitleTypeToLibraryType(value) {
    switch ((value ?? '').trim().toLowerCase()) {
        case 'manwha':
        case 'manhwa':
            return 'manhwa';
        case 'manhua':
            return 'manhua';
        case 'comic':
            return 'comic';
        default:
            return 'manga';
    }
}
function formatDemography(attributes) {
    const libraryType = mapTitleTypeToLibraryType(attributes.type);
    switch (libraryType) {
        case 'manhwa':
            return 'Manhwa';
        case 'manhua':
            return 'Manhua';
        case 'comic':
            return 'Comic';
        default:
            return 'Manga';
    }
}
function isVisibleContentRating(value) {
    const normalized = (value ?? '').trim().toLowerCase();
    return !normalized || normalized === 'safe' || normalized === 'suggestive';
}
function parseGenres(relationships) {
    const genres = relationships
        .filter((relationship) => {
        const type = relationship.type.trim().toLowerCase();
        return type === 'tag' || type === 'primary_tag' || type === 'secondary_tag';
    })
        .map((relationship) => {
        const name = relationship.attributes?.name;
        if (name && typeof name === 'object' && !Array.isArray(name)) {
            return pickLocalizedText(name, ['en']);
        }
        return null;
    })
        .filter((genre) => Boolean(genre));
    return dedupeCaseInsensitive(genres);
}
function getCoverFileName(relationships) {
    const covers = relationships.filter((relationship) => relationship.type === 'cover_art');
    if (covers.length === 0) {
        return null;
    }
    for (const language of PREFERRED_TEXT_LANGS) {
        const localized = covers.find((relationship) => readText(relationship.attributes?.locale)?.toLowerCase() === language);
        const fileName = readText(localized?.attributes?.fileName);
        if (fileName) {
            return fileName;
        }
    }
    return readText(covers[0]?.attributes?.fileName);
}
function buildCoverUrl(titleId, fileName) {
    if (!fileName) {
        return COVER_PLACEHOLDER;
    }
    return `${NAMICOMI_CDN_URL}/covers/${titleId}/${fileName}`;
}
function buildTitleUrl(titleId, slug) {
    return `${NAMICOMI_WEB_URL}/en/title/${titleId}/${slug}`;
}
function buildChapterUrl(chapterId) {
    return `${NAMICOMI_WEB_URL}/en/chapter/${chapterId}`;
}
function getTitleName(attributes) {
    return pickLocalizedText(attributes.title) ?? 'NamiComi';
}
function mapTitleToSummary(raw) {
    const title = getTitleName(raw.attributes);
    const slug = (readText(raw.attributes.slug) ?? slugify(title)) || raw.id;
    return {
        id: raw.id,
        slug,
        libraryType: mapTitleTypeToLibraryType(raw.attributes.type),
        title,
        cover: buildCoverUrl(raw.id, getCoverFileName(raw.relationships)),
        synopsis: buildSynopsis(raw.attributes.description),
        status: formatStatus(raw.attributes.publicationStatus),
        demography: formatDemography(raw.attributes),
        rating: '',
        genres: parseGenres(raw.relationships),
        chapterCount: 0,
        sourceUrl: buildTitleUrl(raw.id, slug),
        source: 'namicomi',
    };
}
function dedupeSummaries(items) {
    const unique = new Map();
    for (const item of items) {
        unique.set(`${item.source}:${item.id}`, item);
    }
    return Array.from(unique.values());
}
function dedupeRecentChapters(items) {
    const sorted = [...items].sort((left, right) => {
        const leftValue = left.publishedAt ? new Date(left.publishedAt).getTime() : 0;
        const rightValue = right.publishedAt ? new Date(right.publishedAt).getTime() : 0;
        return rightValue - leftValue;
    });
    const unique = new Map();
    for (const item of sorted) {
        const key = `${item.source ?? 'unknown'}:${item.mangaId}`;
        if (!unique.has(key)) {
            unique.set(key, item);
        }
    }
    return Array.from(unique.values());
}
function getOrganizationNames(relationships) {
    return dedupeCaseInsensitive(relationships
        .filter((relationship) => relationship.type === 'organization')
        .map((relationship) => readText(relationship.attributes?.name))
        .filter((name) => Boolean(name)));
}
function buildApiUrl(path, params) {
    const url = new URL(path.startsWith('http') ? path : `${NAMICOMI_API_URL}${path}`);
    for (const [key, value] of Object.entries(params)) {
        if (Array.isArray(value)) {
            for (const item of value) {
                url.searchParams.append(key, String(item));
            }
            continue;
        }
        if (value === undefined || value === null) {
            continue;
        }
        const text = String(value);
        if (text.trim()) {
            url.searchParams.append(key, text);
        }
    }
    return url.toString();
}
async function requestNamiComiJson(path, params = {}, signal, init = {}) {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    headers.set('Origin', NAMICOMI_WEB_URL);
    headers.set('Referer', `${NAMICOMI_WEB_URL}/`);
    headers.set('User-Agent', USER_AGENT);
    if (init.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(buildApiUrl(path, params), {
        ...init,
        headers,
        signal,
    });
    if (!response.ok) {
        let message = `NamiComi respondio ${response.status}.`;
        if (response.status === 402) {
            throw new ApiError('Este capitulo requiere suscripcion en NamiComi.', 402);
        }
        try {
            const payload = (await response.json());
            message = payload.errors?.[0]?.detail ?? payload.errors?.[0]?.title ?? payload.message ?? message;
        }
        catch {
            message = response.statusText || message;
        }
        throw new ApiError(message, response.status);
    }
    const bodyText = await response.text();
    if (!bodyText.trim()) {
        return null;
    }
    return JSON.parse(bodyText);
}
function buildCommonIncludeParams() {
    return {
        'includes[]': ['cover_art', 'organization', 'tag', 'primary_tag', 'secondary_tag'],
    };
}
function buildTitleCollectionParams(limit) {
    return {
        ...buildCommonIncludeParams(),
        limit,
        'availableTranslatedLanguages[]': [...PREFERRED_TRANSLATED_LANGS],
    };
}
async function getTitleCollection(cacheKey, params, signal, ttlMs = CACHE_TTL_MS) {
    const cached = getCacheValue(collectionCache.get(cacheKey));
    if (cached) {
        return cached;
    }
    const payload = await requestNamiComiJson('/title/search', params, signal);
    const summaries = dedupeSummaries((payload?.data ?? [])
        .filter((item) => isVisibleContentRating(item.attributes.contentRating))
        .map((item) => mapTitleToSummary(item)));
    collectionCache.set(cacheKey, setCacheValue(summaries, ttlMs));
    return summaries;
}
async function getTitlesByIds(ids, signal) {
    const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (uniqueIds.length === 0) {
        return new Map();
    }
    const payload = await requestNamiComiJson('/title/search', {
        ...buildCommonIncludeParams(),
        limit: uniqueIds.length,
        'ids[]': uniqueIds,
    }, signal);
    const items = (payload?.data ?? []).filter((item) => isVisibleContentRating(item.attributes.contentRating));
    return new Map(items.map((item) => [item.id, item]));
}
async function getTitleRaw(id, signal) {
    const cacheKey = id.trim();
    const cached = getCacheValue(titleCache.get(cacheKey));
    if (cached) {
        return cached;
    }
    const payload = await requestNamiComiJson(`/title/${encodeURIComponent(cacheKey)}`, buildCommonIncludeParams(), signal);
    const title = payload?.data;
    if (!title) {
        throw new ApiError('NamiComi no devolvio datos para este titulo.', 404);
    }
    titleCache.set(cacheKey, setCacheValue(title, DETAIL_TTL_MS));
    return title;
}
function buildChapterNumberLabel(chapter) {
    const number = readText(chapter.chapter);
    if (number) {
        return `Capitulo ${number}`;
    }
    return 'Capitulo especial';
}
function buildChapterShortTitle(chapter) {
    const parts = [];
    const volume = readText(chapter.volume);
    const number = readText(chapter.chapter);
    const name = readText(chapter.name);
    if (volume) {
        parts.push(`Vol. ${volume}`);
    }
    parts.push(number ? `Capitulo ${number}` : 'Capitulo especial');
    if (name) {
        parts.push(name);
    }
    return parts.join(' - ');
}
function getChapterDate(chapter) {
    return (readText(chapter.attributes.publishAt) ??
        readText(chapter.attributes.createdAt) ??
        readText(chapter.attributes.updatedAt));
}
function getChapterSortValue(chapter) {
    const volume = Number(readText(chapter.attributes.volume));
    const number = Number(readText(chapter.attributes.chapter));
    const date = getChapterDate(chapter) ? new Date(getChapterDate(chapter)).getTime() : 0;
    return {
        volume: Number.isFinite(volume) ? volume : 0,
        chapter: Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER,
        date,
    };
}
function mapChapterToSummary(manga, chapter) {
    const shortTitle = buildChapterShortTitle(chapter.attributes);
    return {
        id: chapter.id,
        slug: `chapter-${chapter.id}`,
        title: `${manga.title} - ${shortTitle}`,
        numberLabel: buildChapterNumberLabel(chapter.attributes),
        shortTitle,
        cover: manga.cover,
        sourceUrl: buildChapterUrl(chapter.id),
        publishedAt: getChapterDate(chapter),
    };
}
async function getTitleChapters(manga, signal) {
    const cacheKey = manga.id.trim();
    const cached = getCacheValue(chapterFeedCache.get(cacheKey));
    if (cached) {
        return cached;
    }
    const rawChapters = [];
    let offset = 0;
    let total = 0;
    do {
        const payload = await requestNamiComiJson('/chapter', {
            titleId: manga.id,
            'includes[]': ['organization'],
            limit: CHAPTER_LIST_LIMIT,
            offset,
            'translatedLanguages[]': [...PREFERRED_TRANSLATED_LANGS],
            'order[volume]': 'desc',
            'order[chapter]': 'desc',
        }, signal);
        const data = payload?.data ?? [];
        rawChapters.push(...data);
        total = payload?.meta.total ?? data.length;
        offset += payload?.meta.limit ?? CHAPTER_LIST_LIMIT;
    } while (offset < total);
    const sorted = [...rawChapters].sort((left, right) => {
        const leftValue = getChapterSortValue(left);
        const rightValue = getChapterSortValue(right);
        if (leftValue.volume !== rightValue.volume) {
            return leftValue.volume - rightValue.volume;
        }
        if (leftValue.chapter !== rightValue.chapter) {
            return leftValue.chapter - rightValue.chapter;
        }
        return leftValue.date - rightValue.date;
    });
    const feedData = {
        summaries: sorted.map((chapter) => mapChapterToSummary(manga, chapter)),
        rawById: new Map(rawChapters.map((chapter) => [chapter.id, chapter])),
    };
    chapterFeedCache.set(cacheKey, setCacheValue(feedData, DETAIL_TTL_MS));
    return feedData;
}
async function getRecentChapters(signal) {
    const cached = getCacheValue(recentCache);
    if (cached) {
        return cached;
    }
    const payload = await requestNamiComiJson('/chapter', {
        limit: RECENT_CHAPTER_LIMIT,
        offset: 0,
        'translatedLanguages[]': [...PREFERRED_TRANSLATED_LANGS],
        'order[publishAt]': 'desc',
    }, signal);
    const titleIds = (payload?.data ?? [])
        .map((chapter) => chapter.relationships.find((relationship) => relationship.type === 'title')?.id ?? '')
        .filter(Boolean);
    const titlesById = await getTitlesByIds(titleIds, signal);
    const chapters = (payload?.data ?? []).map((chapter) => {
        const titleId = chapter.relationships.find((relationship) => relationship.type === 'title')?.id;
        if (!titleId) {
            return null;
        }
        const rawTitle = titlesById.get(titleId);
        if (!rawTitle) {
            return null;
        }
        const manga = mapTitleToSummary(rawTitle);
        return {
            mangaId: manga.id,
            mangaSlug: manga.slug,
            mangaTitle: manga.title,
            libraryType: manga.libraryType,
            chapterId: chapter.id,
            chapterSlug: `chapter-${chapter.id}`,
            chapterTitle: buildChapterShortTitle(chapter.attributes),
            numberLabel: buildChapterNumberLabel(chapter.attributes),
            cover: manga.cover,
            sourceUrl: buildChapterUrl(chapter.id),
            source: 'namicomi',
            publishedAt: getChapterDate(chapter),
        };
    });
    const deduped = dedupeRecentChapters(chapters.filter((chapter) => chapter !== null)).slice(0, RECENT_CHAPTER_LIMIT);
    recentCache = setCacheValue(deduped, HOME_TTL_MS);
    return deduped;
}
function parseAlternativeTitles(raw, summary) {
    return dedupeCaseInsensitive(Object.values(raw.attributes.title ?? {})
        .map((value) => readText(value))
        .filter((value) => Boolean(value))
        .filter((value) => value.toLowerCase() !== summary.title.toLowerCase()));
}
async function getRelatedTitles(currentId, signal) {
    const home = await getNamiComiMangaHome(signal);
    return dedupeSummaries([...home.spotlight, ...home.trending])
        .filter((item) => item.id !== currentId)
        .slice(0, 8);
}
export async function getNamiComiMangaHome(signal) {
    const cached = getCacheValue(homeCache);
    if (cached) {
        return cached;
    }
    const [trending, spotlight, latestChapters] = await Promise.all([
        getTitleCollection('namicomi:trending', {
            ...buildTitleCollectionParams(HOME_COLLECTION_LIMIT),
            'order[views]': 'desc',
        }, signal, HOME_TTL_MS),
        getTitleCollection('namicomi:spotlight', {
            ...buildTitleCollectionParams(SPOTLIGHT_LIMIT),
            'order[publishedAt]': 'desc',
        }, signal, HOME_TTL_MS),
        getRecentChapters(signal),
    ]);
    const featured = trending[0] ?? spotlight[0];
    if (!featured) {
        throw new ApiError('NamiComi no devolvio series para el home.', 502);
    }
    const home = {
        featured,
        latestChapters,
        trending,
        spotlight: dedupeSummaries([...spotlight, ...trending])
            .filter((item) => item.id !== featured.id)
            .slice(0, SPOTLIGHT_LIMIT),
        source: 'namicomi',
        notice: NAMICOMI_NOTICE,
    };
    homeCache = setCacheValue(home, HOME_TTL_MS);
    return home;
}
export async function searchNamiComiManga(query, signal) {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
        const home = await getNamiComiMangaHome(signal);
        return home.trending;
    }
    return getTitleCollection(`namicomi:search:${cleanQuery.toLowerCase()}`, {
        ...buildTitleCollectionParams(SEARCH_LIMIT),
        title: cleanQuery.replace(/\s+/g, ' '),
    }, signal);
}
export async function getNamiComiMangaDetail(id, _slug, signal) {
    const rawTitle = await getTitleRaw(id, signal);
    if (!isVisibleContentRating(rawTitle.attributes.contentRating)) {
        throw new ApiError('Este titulo no esta disponible en el catalogo visible de NamiComi.', 404);
    }
    const summary = mapTitleToSummary(rawTitle);
    const [chapters, related] = await Promise.all([
        getTitleChapters(summary, signal),
        getRelatedTitles(summary.id, signal).catch(() => []),
    ]);
    return {
        ...summary,
        description: buildDescription(rawTitle.attributes.description),
        alternativeTitles: parseAlternativeTitles(rawTitle, summary),
        chapters: chapters.summaries,
        related,
        chapterCount: Math.max(summary.chapterCount, chapters.summaries.length),
        notice: `${NAMICOMI_NOTICE} ${getOrganizationNames(rawTitle.relationships).length > 0 ? `Grupo: ${getOrganizationNames(rawTitle.relationships).join(', ')}.` : ''}`.trim(),
    };
}
function getBestPageVariant(data) {
    if (Array.isArray(data.source) && data.source.length > 0) {
        return { folder: 'source', files: data.source };
    }
    if (Array.isArray(data.high) && data.high.length > 0) {
        return { folder: 'high', files: data.high };
    }
    if (Array.isArray(data.medium) && data.medium.length > 0) {
        return { folder: 'medium', files: data.medium };
    }
    if (Array.isArray(data.low) && data.low.length > 0) {
        return { folder: 'low', files: data.low };
    }
    return null;
}
export async function getNamiComiMangaReadData(id, slug, chapterId, signal) {
    const detail = await getNamiComiMangaDetail(id, slug, signal);
    const feed = await getTitleChapters(detail, signal);
    const currentChapter = detail.chapters.find((chapter) => chapter.id === chapterId.trim()) ??
        feed.summaries.find((chapter) => chapter.id === chapterId.trim()) ?? {
        id: chapterId.trim(),
        slug: `chapter-${chapterId.trim()}`,
        title: `${detail.title} - Capitulo`,
        numberLabel: 'Capitulo',
        shortTitle: 'Capitulo',
        cover: detail.cover,
        sourceUrl: buildChapterUrl(chapterId.trim()),
        publishedAt: null,
    };
    let pages = [];
    let readingMode = 'maintenance';
    let notice = NAMICOMI_READ_NOTICE;
    try {
        const payload = await requestNamiComiJson(`/images/chapter/${encodeURIComponent(chapterId.trim())}`, { newQualities: 'true' }, signal);
        const data = payload?.data;
        const variant = data ? getBestPageVariant(data) : null;
        if (data && variant) {
            const baseUrl = readText(data.baseUrl) ?? NAMICOMI_CDN_URL;
            const hash = readText(data.hash);
            if (hash) {
                pages = variant.files.map((file) => `${baseUrl}/chapter/${chapterId.trim()}/${hash}/${variant.folder}/${file.filename}`);
            }
        }
        readingMode = pages.length > 0 ? 'pages' : 'external';
        if (pages.length === 0) {
            notice = 'NamiComi no devolvio paginas listas para este capitulo. Puedes abrirlo en la fuente original.';
        }
    }
    catch (error) {
        readingMode = 'external';
        notice =
            error instanceof ApiError && error.statusCode === 402
                ? 'Este capitulo requiere suscripcion en NamiComi. Puedes abrir la fuente original si tienes acceso.'
                : 'No pude reconstruir este capitulo desde NamiComi. Puedes abrir la fuente original.';
    }
    return {
        manga: detail,
        chapter: currentChapter,
        chapters: detail.chapters,
        pages,
        readingMode,
        externalUrl: currentChapter.sourceUrl,
        source: 'namicomi',
        notice,
    };
}
