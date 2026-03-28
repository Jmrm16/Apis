import { ApiError } from '../lib/http.js';
const MANGA_PROVIDER_SEPARATOR = '__';
function encodeMangaLibraryType(source, type) {
    const normalizedType = type.trim().toLowerCase() || 'comic';
    return source === 'olympus' ? normalizedType : `${source}${MANGA_PROVIDER_SEPARATOR}${normalizedType}`;
}
function decodeMangaLibraryType(libraryType) {
    const normalized = libraryType.trim().toLowerCase() || 'comic';
    const separatorIndex = normalized.indexOf(MANGA_PROVIDER_SEPARATOR);
    if (separatorIndex === -1) {
        return {
            source: 'olympus',
            type: normalized,
        };
    }
    return {
        source: normalized.slice(0, separatorIndex),
        type: normalized.slice(separatorIndex + MANGA_PROVIDER_SEPARATOR.length) || 'comic',
    };
}
const MANGADEX_API_BASE_URL = 'https://api.mangadex.org';
const MANGADEX_SITE_BASE_URL = 'https://mangadex.org';
const MANGADEX_UPLOADS_BASE_URL = 'https://uploads.mangadex.org';
const COVER_PLACEHOLDER = 'https://placehold.co/600x900/111111/f59e0b?text=MangaDex';
const DIRECT_NOTICE = 'Biblioteca servida desde el backend usando MangaDex. Se priorizan traducciones en espanol y se mantiene lectura interna desde el at-home server oficial.';
const DIRECT_READ_NOTICE = 'Lectura interna servida desde el backend usando MangaDex y su at-home server oficial.';
const CACHE_TTL_MS = 5 * 60 * 1000;
const DETAIL_TTL_MS = 15 * 60 * 1000;
const HOME_TTL_MS = 5 * 60 * 1000;
const CHAPTER_FEED_PAGE_SIZE = 100;
const HOME_COLLECTION_LIMIT = 18;
const SPOTLIGHT_LIMIT = 12;
const RECENT_CHAPTER_LIMIT = 18;
const PREFERRED_TEXT_LANGS = ['es-la', 'es', 'en', 'ja-ro', 'ja', 'ko-ro', 'ko'];
const PREFERRED_TRANSLATED_LANGS = ['es-la', 'es', 'en'];
const ALLOWED_CONTENT_RATINGS = ['safe', 'suggestive'];
let homeCache = null;
let recentCache = null;
const collectionCache = new Map();
const mangaCache = new Map();
const feedCache = new Map();
const atHomeCache = new Map();
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
function slugify(value) {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
function titleCase(value) {
    return value
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
        .join(' ');
}
function sanitizeDescription(value) {
    return normalizeWhitespace(value
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
        .replace(/^\s*[-*>#]+\s*/gm, '')
        .replace(/^---+$/gm, '')
        .replace(/\n+/g, ' '));
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
function collectAlternativeTitles(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const titles = value
        .map((entry) => pickLocalizedText(entry, PREFERRED_TEXT_LANGS))
        .filter((item) => Boolean(item));
    return dedupeCaseInsensitive(titles);
}
function buildSynopsis(value) {
    const description = pickLocalizedText(value);
    if (!description) {
        return 'Abre la ficha para cargar la descripcion real desde MangaDex.';
    }
    const clean = sanitizeDescription(description);
    return clean.length > 260 ? `${clean.slice(0, 260).trim()}...` : clean;
}
function buildDescription(value) {
    const description = pickLocalizedText(value);
    if (!description) {
        return 'MangaDex no devolvio una descripcion completa para esta obra.';
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
function formatDemography(value) {
    const normalized = readText(value);
    return normalized ? titleCase(normalized) : 'Sin demografia';
}
function inferLibraryType(attributes) {
    switch ((attributes.originalLanguage ?? '').trim().toLowerCase()) {
        case 'ko':
        case 'ko-ro':
            return 'manhwa';
        case 'zh':
        case 'zh-hk':
        case 'zh-ro':
            return 'manhua';
        case 'en':
            return 'comic';
        default:
            return 'manga';
    }
}
function parseGenres(tags) {
    if (!Array.isArray(tags)) {
        return [];
    }
    const genres = tags
        .filter((tag) => {
        const group = readText(tag.attributes?.group);
        return group === 'genre' || group === 'theme';
    })
        .map((tag) => pickLocalizedText(tag.attributes?.name, ['en']))
        .filter((genre) => Boolean(genre));
    return dedupeCaseInsensitive(genres);
}
function getCoverFileName(relationships) {
    if (!Array.isArray(relationships)) {
        return null;
    }
    const coverRelation = relationships.find((relationship) => relationship.type === 'cover_art');
    return readText(coverRelation?.attributes?.fileName);
}
function buildMangaUrl(id, slug) {
    return `${MANGADEX_SITE_BASE_URL}/title/${id}/${slug}`;
}
function buildChapterUrl(id) {
    return `${MANGADEX_SITE_BASE_URL}/chapter/${id}`;
}
function buildCoverUrl(mangaId, fileName) {
    if (!fileName) {
        return COVER_PLACEHOLDER;
    }
    return `${MANGADEX_UPLOADS_BASE_URL}/covers/${mangaId}/${fileName}.512.jpg`;
}
function getMangaTitle(attributes) {
    return (pickLocalizedText(attributes.title) ??
        collectAlternativeTitles(attributes.altTitles)[0] ??
        'MangaDex');
}
function getMangaSummaryFromChapterRelationship(chapter) {
    const mangaRelationship = chapter.relationships.find((relationship) => relationship.type === 'manga');
    if (!mangaRelationship) {
        return null;
    }
    const relationshipAttributes = mangaRelationship.attributes;
    const title = pickLocalizedText(relationshipAttributes?.title) ??
        collectAlternativeTitles(relationshipAttributes?.altTitles)[0] ??
        mangaRelationship.id;
    const slug = slugify(title) || mangaRelationship.id;
    return {
        id: mangaRelationship.id,
        slug,
        libraryType: encodeMangaLibraryType('mangadex', inferLibraryType({
            originalLanguage: relationshipAttributes?.originalLanguage ?? null,
        })),
        title,
        cover: COVER_PLACEHOLDER,
        synopsis: buildSynopsis(relationshipAttributes?.description),
        status: formatStatus(relationshipAttributes?.status),
        demography: formatDemography(relationshipAttributes?.publicationDemographic),
        rating: '',
        genres: parseGenres(relationshipAttributes?.tags),
        chapterCount: readNumber(relationshipAttributes?.lastChapter),
        sourceUrl: buildMangaUrl(mangaRelationship.id, slug),
        source: 'mangadex',
    };
}
function mapMangaDexMangaToSummary(raw) {
    const title = getMangaTitle(raw.attributes);
    const slug = slugify(title) || raw.id;
    return {
        id: raw.id,
        slug,
        libraryType: encodeMangaLibraryType('mangadex', inferLibraryType(raw.attributes)),
        title,
        cover: buildCoverUrl(raw.id, getCoverFileName(raw.relationships)),
        synopsis: buildSynopsis(raw.attributes.description),
        status: formatStatus(raw.attributes.status),
        demography: formatDemography(raw.attributes.publicationDemographic),
        rating: '',
        genres: parseGenres(raw.attributes.tags),
        chapterCount: readNumber(raw.attributes.lastChapter),
        sourceUrl: buildMangaUrl(raw.id, slug),
        source: 'mangadex',
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
function buildApiUrl(path, params) {
    const url = new URL(path, MANGADEX_API_BASE_URL);
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
async function requestJson(path, params, signal) {
    const response = await fetch(buildApiUrl(path, params), {
        headers: {
            Accept: 'application/json',
        },
        signal,
    });
    if (!response.ok) {
        throw new ApiError(`MangaDex respondio ${response.status}.`, response.status);
    }
    return (await response.json());
}
function buildBaseMangaParams(limit) {
    return {
        limit,
        'includes[]': ['cover_art'],
        'availableTranslatedLanguage[]': [...PREFERRED_TRANSLATED_LANGS],
        'contentRating[]': [...ALLOWED_CONTENT_RATINGS],
    };
}
async function getMangaCollection(cacheKey, params, signal, ttlMs = CACHE_TTL_MS) {
    const cached = getCacheValue(collectionCache.get(cacheKey));
    if (cached) {
        return cached;
    }
    const payload = await requestJson('/manga', params, signal);
    const summaries = dedupeSummaries(payload.data.map((item) => mapMangaDexMangaToSummary(item)));
    collectionCache.set(cacheKey, setCacheValue(summaries, ttlMs));
    return summaries;
}
async function getMangaByIds(ids, signal) {
    const uniqueIds = [...new Set(ids.filter((id) => id.trim()))];
    if (uniqueIds.length === 0) {
        return new Map();
    }
    const payload = await requestJson('/manga', {
        limit: uniqueIds.length,
        'ids[]': uniqueIds,
        'includes[]': ['cover_art'],
    }, signal);
    return new Map(payload.data.map((item) => [item.id, item]));
}
async function getMangaRaw(id, signal) {
    const cacheKey = id.trim();
    const cached = getCacheValue(mangaCache.get(cacheKey));
    if (cached) {
        return cached;
    }
    const payload = await requestJson(`/manga/${encodeURIComponent(cacheKey)}`, {
        'includes[]': ['cover_art'],
    }, signal);
    mangaCache.set(cacheKey, setCacheValue(payload.data, DETAIL_TTL_MS));
    return payload.data;
}
function buildChapterNumberLabel(value) {
    const normalized = readText(value);
    if (!normalized) {
        return 'Capitulo especial';
    }
    const parsed = Number(normalized);
    if (Number.isFinite(parsed) && Number.isInteger(parsed)) {
        return `Capitulo ${String(parsed).padStart(2, '0')}`;
    }
    return `Capitulo ${normalized}`;
}
function buildChapterShortTitle(value, title) {
    const numberLabel = buildChapterNumberLabel(value);
    const chapterTitle = readText(title);
    return chapterTitle ? `${numberLabel} - ${chapterTitle}` : numberLabel;
}
function getChapterDate(chapter) {
    return (readText(chapter.attributes.readableAt) ??
        readText(chapter.attributes.publishAt) ??
        readText(chapter.attributes.createdAt) ??
        readText(chapter.attributes.updatedAt));
}
function getChapterKey(chapter) {
    const chapterNumber = readText(chapter.attributes.chapter);
    if (chapterNumber) {
        return `chapter:${chapterNumber}`;
    }
    const volume = readText(chapter.attributes.volume);
    const title = readText(chapter.attributes.title);
    if (volume || title) {
        return `special:${volume ?? ''}:${(title ?? '').toLowerCase()}`;
    }
    return `id:${chapter.id}`;
}
function getLanguagePriority(language) {
    const normalized = (language ?? '').trim().toLowerCase();
    const index = PREFERRED_TRANSLATED_LANGS.indexOf(normalized);
    return index === -1 ? PREFERRED_TRANSLATED_LANGS.length : index;
}
function compareChapterPriority(left, right) {
    const languagePriority = getLanguagePriority(left.attributes.translatedLanguage) -
        getLanguagePriority(right.attributes.translatedLanguage);
    if (languagePriority !== 0) {
        return languagePriority;
    }
    const leftDate = getChapterDate(left) ? new Date(getChapterDate(left)).getTime() : 0;
    const rightDate = getChapterDate(right) ? new Date(getChapterDate(right)).getTime() : 0;
    if (leftDate !== rightDate) {
        return rightDate - leftDate;
    }
    return right.id.localeCompare(left.id);
}
function getChapterSortValue(chapter) {
    const parsed = Number(readText(chapter.attributes.chapter));
    if (Number.isFinite(parsed)) {
        return parsed;
    }
    return Number.MAX_SAFE_INTEGER;
}
function selectPreferredChapters(chapters) {
    const selected = new Map();
    for (const chapter of chapters) {
        const key = getChapterKey(chapter);
        const current = selected.get(key);
        if (!current || compareChapterPriority(chapter, current) < 0) {
            selected.set(key, chapter);
        }
    }
    return Array.from(selected.values()).sort((left, right) => {
        const leftSort = getChapterSortValue(left);
        const rightSort = getChapterSortValue(right);
        if (leftSort !== rightSort) {
            return leftSort - rightSort;
        }
        const leftDate = getChapterDate(left) ? new Date(getChapterDate(left)).getTime() : 0;
        const rightDate = getChapterDate(right) ? new Date(getChapterDate(right)).getTime() : 0;
        return leftDate - rightDate;
    });
}
function mapMangaDexChapterToSummary(manga, chapter) {
    return {
        id: chapter.id,
        slug: `chapter-${chapter.id}`,
        title: `${manga.title} - ${buildChapterShortTitle(chapter.attributes.chapter, chapter.attributes.title)}`,
        numberLabel: buildChapterNumberLabel(chapter.attributes.chapter),
        shortTitle: buildChapterShortTitle(chapter.attributes.chapter, chapter.attributes.title),
        cover: manga.cover,
        sourceUrl: readText(chapter.attributes.externalUrl) ?? buildChapterUrl(chapter.id),
        publishedAt: getChapterDate(chapter),
    };
}
async function getFeedData(manga, signal) {
    const cacheKey = manga.id.trim();
    const cached = getCacheValue(feedCache.get(cacheKey));
    if (cached) {
        return cached;
    }
    const rawChapters = [];
    let offset = 0;
    let total = 0;
    do {
        const payload = await requestJson(`/manga/${encodeURIComponent(cacheKey)}/feed`, {
            limit: CHAPTER_FEED_PAGE_SIZE,
            offset,
            'translatedLanguage[]': [...PREFERRED_TRANSLATED_LANGS],
            'order[chapter]': 'desc',
            'order[volume]': 'desc',
        }, signal);
        rawChapters.push(...payload.data);
        total = payload.total;
        offset += payload.limit;
    } while (offset < total);
    const selectedChapters = selectPreferredChapters(rawChapters);
    const feedData = {
        summaries: selectedChapters.map((chapter) => mapMangaDexChapterToSummary(manga, chapter)),
        rawChaptersById: new Map(rawChapters.map((chapter) => [chapter.id, chapter])),
    };
    feedCache.set(cacheKey, setCacheValue(feedData, DETAIL_TTL_MS));
    return feedData;
}
async function getRecentChapters(signal) {
    const cached = getCacheValue(recentCache);
    if (cached) {
        return cached;
    }
    const payload = await requestJson('/chapter', {
        limit: RECENT_CHAPTER_LIMIT,
        'translatedLanguage[]': [...PREFERRED_TRANSLATED_LANGS],
        'includes[]': ['manga'],
        'contentRating[]': [...ALLOWED_CONTENT_RATINGS],
        'order[readableAt]': 'desc',
    }, signal);
    const mangaIds = payload.data
        .map((chapter) => chapter.relationships.find((relationship) => relationship.type === 'manga')?.id ?? '')
        .filter(Boolean);
    const mangaById = await getMangaByIds(mangaIds, signal);
    const chapters = payload.data
        .map((chapter) => {
        const mangaRelationship = chapter.relationships.find((relationship) => relationship.type === 'manga');
        if (!mangaRelationship) {
            return null;
        }
        const mangaSummary = mangaById.has(mangaRelationship.id)
            ? mapMangaDexMangaToSummary(mangaById.get(mangaRelationship.id))
            : getMangaSummaryFromChapterRelationship(chapter);
        if (!mangaSummary) {
            return null;
        }
        const recentChapter = {
            mangaId: mangaSummary.id,
            mangaSlug: mangaSummary.slug,
            mangaTitle: mangaSummary.title,
            libraryType: mangaSummary.libraryType,
            chapterId: chapter.id,
            chapterSlug: `chapter-${chapter.id}`,
            chapterTitle: buildChapterShortTitle(chapter.attributes.chapter, chapter.attributes.title),
            numberLabel: buildChapterNumberLabel(chapter.attributes.chapter),
            cover: mangaSummary.cover,
            sourceUrl: readText(chapter.attributes.externalUrl) ?? buildChapterUrl(chapter.id),
            source: 'mangadex',
            publishedAt: getChapterDate(chapter),
        };
        return recentChapter;
    })
        .filter((chapter) => Boolean(chapter));
    const deduped = dedupeRecentChapters(chapters).slice(0, RECENT_CHAPTER_LIMIT);
    recentCache = setCacheValue(deduped);
    return deduped;
}
export async function getMangaDexMangaHome(signal) {
    const cached = getCacheValue(homeCache);
    if (cached) {
        return cached;
    }
    const [trending, spotlight, latestChapters] = await Promise.all([
        getMangaCollection('mangadex:trending', {
            ...buildBaseMangaParams(HOME_COLLECTION_LIMIT),
            'order[followedCount]': 'desc',
        }, signal, HOME_TTL_MS),
        getMangaCollection('mangadex:spotlight', {
            ...buildBaseMangaParams(SPOTLIGHT_LIMIT),
            'order[latestUploadedChapter]': 'desc',
        }, signal, HOME_TTL_MS),
        getRecentChapters(signal),
    ]);
    const featured = trending[0] ?? spotlight[0];
    if (!featured) {
        throw new ApiError('MangaDex no devolvio series para home.', 502);
    }
    const home = {
        featured,
        latestChapters,
        trending,
        spotlight: dedupeSummaries([...spotlight, ...trending]).filter((item) => item.id !== featured.id).slice(0, SPOTLIGHT_LIMIT),
        source: 'mangadex',
        notice: DIRECT_NOTICE,
    };
    homeCache = setCacheValue(home, HOME_TTL_MS);
    return home;
}
export async function searchMangaDexManga(query, signal) {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
        const home = await getMangaDexMangaHome(signal);
        return home.trending;
    }
    return getMangaCollection(`mangadex:search:${cleanQuery.toLowerCase()}`, {
        ...buildBaseMangaParams(24),
        title: cleanQuery,
        'order[latestUploadedChapter]': 'desc',
    }, signal);
}
export async function getMangaDexMangaDetail(libraryType, id, slug, signal) {
    const parsedLibraryType = decodeMangaLibraryType(libraryType);
    if (parsedLibraryType.source !== 'mangadex') {
        throw new ApiError('La ruta solicitada no pertenece a MangaDex.', 404);
    }
    const [raw, home] = await Promise.all([
        getMangaRaw(id, signal),
        getMangaDexMangaHome(signal).catch(() => null),
    ]);
    const summary = mapMangaDexMangaToSummary(raw);
    const feed = await getFeedData(summary, signal);
    const relatedIds = raw.relationships
        .filter((relationship) => relationship.type === 'manga')
        .map((relationship) => relationship.id)
        .filter((relatedId) => relatedId !== summary.id)
        .slice(0, 8);
    let related = [];
    if (relatedIds.length > 0) {
        const relatedById = await getMangaByIds(relatedIds, signal);
        related = dedupeSummaries(Array.from(relatedById.values()).map((item) => mapMangaDexMangaToSummary(item))).slice(0, 8);
    }
    if (related.length === 0 && home) {
        related = dedupeSummaries([...home.spotlight, ...home.trending])
            .filter((item) => item.id !== summary.id)
            .slice(0, 8);
    }
    const alternativeTitles = collectAlternativeTitles(raw.attributes.altTitles)
        .filter((title) => title.toLowerCase() !== summary.title.toLowerCase());
    return {
        ...summary,
        slug: slug.trim() || summary.slug,
        description: buildDescription(raw.attributes.description),
        alternativeTitles,
        chapters: feed.summaries,
        related,
        chapterCount: Math.max(summary.chapterCount, feed.summaries.length),
        notice: DIRECT_NOTICE,
    };
}
async function getAtHomeData(chapterId, signal) {
    const cacheKey = chapterId.trim();
    const cached = getCacheValue(atHomeCache.get(cacheKey));
    if (cached) {
        return cached;
    }
    const payload = await requestJson(`/at-home/server/${encodeURIComponent(cacheKey)}`, {}, signal);
    atHomeCache.set(cacheKey, setCacheValue(payload, DETAIL_TTL_MS));
    return payload;
}
export async function getMangaDexMangaReadData(libraryType, id, slug, chapterId, signal) {
    const detail = await getMangaDexMangaDetail(libraryType, id, slug, signal);
    const feed = await getFeedData(detail, signal);
    const currentChapter = detail.chapters.find((chapter) => chapter.id === chapterId.trim()) ??
        mapMangaDexChapterToSummary(detail, feed.rawChaptersById.get(chapterId.trim()) ?? {
            id: chapterId.trim(),
            type: 'chapter',
            attributes: {
                chapter: null,
                title: null,
            },
            relationships: [],
        });
    const rawChapter = feed.rawChaptersById.get(chapterId.trim());
    let pages = [];
    try {
        const atHome = await getAtHomeData(chapterId, signal);
        const files = atHome.chapter.dataSaver.length > 0 ? atHome.chapter.dataSaver : atHome.chapter.data;
        const folder = atHome.chapter.dataSaver.length > 0 ? 'data-saver' : 'data';
        pages = files.map((fileName) => `${atHome.baseUrl}/${folder}/${atHome.chapter.hash}/${fileName}`);
    }
    catch {
        pages = [];
    }
    const externalUrl = readText(rawChapter?.attributes.externalUrl) ?? currentChapter.sourceUrl;
    return {
        manga: detail,
        chapter: currentChapter,
        chapters: detail.chapters,
        pages,
        readingMode: pages.length > 0 ? 'pages' : 'maintenance',
        externalUrl,
        source: 'mangadex',
        notice: pages.length > 0 ? DIRECT_READ_NOTICE : 'MangaDex no devolvio paginas para este capitulo.',
    };
}
