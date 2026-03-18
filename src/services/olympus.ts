import { ApiError, requestText } from '../lib/http.js'
import type {
  MangaChapterSummary,
  MangaDetail,
  MangaHomeData,
  MangaReadData,
  MangaRecentChapter,
  MangaSummary,
  OlympusChapterData,
} from '../types/manga.js'

const OLYMPUS_BASE_URL = 'https://olympusbiblioteca.com'
const OLYMPUS_DASHBOARD_BASE_URL = 'https://dashboard.olympusbiblioteca.com'
const OLYMPUS_NOTICE =
  'Olympus integrado desde la API publica del sitio. La lectura usa el endpoint real de capitulos para evitar hojas incompletas.'
const OLYMPUS_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  Referer: `${OLYMPUS_BASE_URL}/`,
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
}
const OLYMPUS_HTML_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  Referer: `${OLYMPUS_BASE_URL}/`,
  'User-Agent': OLYMPUS_HEADERS['User-Agent'],
}
const CACHE_TTL_MS = 5 * 60 * 1000
const FULL_CATALOG_TTL_MS = 10 * 60 * 1000
const FULL_CATALOG_BATCH_SIZE = 6
const CHAPTERS_BATCH_SIZE = 4

type OlympusLibraryType = 'comic'

type NuxtPayload = unknown[]

interface OlympusChapterOptions {
  payloadUrl?: string
  chapterUrl?: string
  chapterId?: string
  slug?: string
  type?: string
}

interface OlympusStatusRaw {
  id: number | string
  name: string
}

interface OlympusSeriesRaw {
  id: number | string
  name: string
  slug: string
  status?: OlympusStatusRaw | null
  cover?: string | null
  cover_srcset?: string | null
  chapter_count?: number | string | null
  type?: string | null
  total_views?: number | string | null
  monthly_views?: number | string | null
}

interface OlympusRecommendedRaw extends OlympusSeriesRaw {}

interface OlympusSeriesPageResponse {
  data: {
    series: {
      current_page: number
      data: OlympusSeriesRaw[]
      last_page: number
      total: number
    }
    recommended_series?: string | OlympusRecommendedRaw[]
  }
}

interface OlympusGenreRaw {
  id: number | string
  name: string
}

interface OlympusTeamRaw {
  id: number | string
  name: string
  cover?: string | null
}

interface OlympusFirstChapterRaw {
  id: number | string
  name: string
}

interface OlympusSeriesDetailRaw {
  id: number | string
  name: string
  summary?: string | null
  slug: string
  status?: OlympusStatusRaw | null
  note?: string | null
  disqus_key?: string | null
  disqus_page_url?: string | null
  view_count?: number | string | null
  bookmark_count?: number | string | null
  like_count?: number | string | null
  bookmarked?: boolean
  liked?: boolean
  rating?: number | string | null
  genres?: OlympusGenreRaw[]
  created_at?: string | null
  cover?: string | null
  team?: OlympusTeamRaw | null
  type?: string | null
  first_chapter?: OlympusFirstChapterRaw | null
  gallery?: string[] | null
  chapter_count?: number | string | null
}

interface OlympusSeriesDetailResponse {
  data: OlympusSeriesDetailRaw
}

interface OlympusSeriesChapterRaw {
  name: string
  id: number | string
  published_at?: string | null
  team?: OlympusTeamRaw | null
  read_by_auth?: boolean
}

interface OlympusSeriesChaptersResponse {
  data: OlympusSeriesChapterRaw[]
  meta: {
    current_page: number
    last_page: number
    total: number
  }
}

interface OlympusSeriesPageData {
  items: MangaSummary[]
  recommended: MangaSummary[]
  currentPage: number
  lastPage: number
  total: number
}

interface OlympusRecentSeriesGroup {
  manga: MangaSummary
  chapters: MangaRecentChapter[]
}

interface CacheEntry<T> {
  expiresAt: number
  value: T
}

const seriesPageCache = new Map<string, CacheEntry<OlympusSeriesPageData>>()
const seriesDetailCache = new Map<string, CacheEntry<OlympusSeriesDetailRaw>>()
const seriesChaptersCache = new Map<string, CacheEntry<MangaChapterSummary[]>>()
let recentSeriesCache: CacheEntry<OlympusRecentSeriesGroup[]> | null = null
let fullCatalogCache: CacheEntry<MangaSummary[]> | null = null

function getCacheValue<T>(entry: CacheEntry<T> | null | undefined): T | null {
  if (!entry) {
    return null
  }

  if (entry.expiresAt <= Date.now()) {
    return null
  }

  return entry.value
}

function setCacheValue<T>(value: T, ttlMs = CACHE_TTL_MS): CacheEntry<T> {
  return {
    expiresAt: Date.now() + ttlMs,
    value,
  }
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? normalizeWhitespace(value) : null
}

function readName(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim() || null
  }

  if (value && typeof value === 'object' && 'name' in value) {
    return readText(value.name)
  }

  return null
}

function readNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toIdString(value: number | string | null | undefined): string {
  const text = String(value ?? '').trim()
  return text || '0'
}

function ensureUrlPath(value: string): string {
  return value.startsWith('/') ? value : `/${value}`
}

function buildSiteUrl(path: string): string {
  return new URL(ensureUrlPath(path), OLYMPUS_BASE_URL).toString()
}

function buildOlympusSourceUrl(slug: string): string {
  return buildSiteUrl(`/series/comic-${slug}`)
}

function buildOlympusChapterUrl(slug: string, chapterId: string): string {
  return buildSiteUrl(`/capitulo/${chapterId}/comic-${slug}`)
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function buildOlympusSynopsis(summary?: string | null): string {
  const normalized = normalizeWhitespace(summary ?? '')
  if (!normalized) {
    return 'Abre la ficha para cargar la sinopsis real desde Olympus.'
  }

  return normalized.length > 260 ? `${normalized.slice(0, 260).trim()}...` : normalized
}

function padChapterNumber(value: string): string {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? String(parsed).padStart(2, '0') : value
}

function chapterSortValue(value: string, id: string): number {
  const parsed = Number(value)
  if (Number.isFinite(parsed)) {
    return parsed
  }

  return Number(id) || Number.MAX_SAFE_INTEGER
}

function dedupeSummaries(items: MangaSummary[]): MangaSummary[] {
  const unique = new Map<string, MangaSummary>()

  for (const item of items) {
    unique.set(`${item.libraryType}:${item.id}:${item.slug}`, item)
  }

  return Array.from(unique.values())
}

function dedupeRecentChapters(items: MangaRecentChapter[]): MangaRecentChapter[] {
  const unique = new Map<string, MangaRecentChapter>()

  for (const item of items) {
    if (!unique.has(item.mangaId)) {
      unique.set(item.mangaId, item)
    }
  }

  return Array.from(unique.values())
}

function mapOlympusSeriesToSummary(series: OlympusSeriesRaw): MangaSummary {
  const id = toIdString(series.id)
  const title = normalizeWhitespace(series.name)
  const chapterCount = readNumber(series.chapter_count)

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
  }
}

function mapOlympusDetailToSummary(detail: OlympusSeriesDetailRaw): MangaSummary {
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
      .filter((genre): genre is string => Boolean(genre)),
    chapterCount: readNumber(detail.chapter_count),
    sourceUrl: buildOlympusSourceUrl(detail.slug),
    source: 'olympus',
  }
}

function createOlympusChapterSummary(
  manga: MangaSummary,
  chapter: OlympusSeriesChapterRaw,
): MangaChapterSummary {
  const id = toIdString(chapter.id)
  const number = normalizeWhitespace(chapter.name)

  return {
    id,
    slug: `chapter-${id}`,
    title: `${manga.title} - Capitulo ${number}`,
    numberLabel: `Capitulo ${padChapterNumber(number)}`,
    shortTitle: `Capitulo ${number}`,
    cover: manga.cover,
    sourceUrl: buildOlympusChapterUrl(manga.slug, id),
  }
}

function mapRecommendedSeries(value: string | OlympusRecommendedRaw[] | undefined): MangaSummary[] {
  let parsed: OlympusRecommendedRaw[] = []

  if (typeof value === 'string' && value.trim()) {
    try {
      parsed = JSON.parse(value) as OlympusRecommendedRaw[]
    } catch {
      parsed = []
    }
  } else if (Array.isArray(value)) {
    parsed = value
  }

  return dedupeSummaries(parsed.map((item) => mapOlympusSeriesToSummary(item)))
}

async function requestOlympusJson<T>(
  path: string,
  searchParams: Record<string, string | number | undefined>,
  signal?: AbortSignal,
): Promise<T> {
  const url = new URL(path, OLYMPUS_DASHBOARD_BASE_URL)

  for (const [key, value] of Object.entries(searchParams)) {
    if (value !== undefined && value !== null && `${value}`.trim()) {
      url.searchParams.set(key, String(value))
    }
  }

  const response = await fetch(url, {
    headers: OLYMPUS_HEADERS,
    signal,
  })

  if (!response.ok) {
    let message = response.statusText || 'Olympus respondio con un error.'

    try {
      const payload = (await response.json()) as { message?: string }
      if (payload.message) {
        message = payload.message
      }
    } catch {
      // noop
    }

    throw new ApiError(message, response.status)
  }

  return (await response.json()) as T
}

async function getOlympusSeriesPage(
  page = 1,
  signal?: AbortSignal,
): Promise<OlympusSeriesPageData> {
  const cacheKey = `series-page:${page}`
  const cached = getCacheValue(seriesPageCache.get(cacheKey))
  if (cached) {
    return cached
  }

  const payload = await requestOlympusJson<OlympusSeriesPageResponse>(
    '/api/series',
    {
      page,
      direction: 'desc',
      type: 'comic',
    },
    signal,
  )

  const value: OlympusSeriesPageData = {
    items: payload.data.series.data.map((item) => mapOlympusSeriesToSummary(item)),
    recommended: mapRecommendedSeries(payload.data.recommended_series),
    currentPage: payload.data.series.current_page,
    lastPage: payload.data.series.last_page,
    total: payload.data.series.total,
  }

  seriesPageCache.set(cacheKey, setCacheValue(value))
  return value
}

async function getOlympusSeriesDetailRaw(slug: string, signal?: AbortSignal): Promise<OlympusSeriesDetailRaw> {
  const cacheKey = `series-detail:${slug}`
  const cached = getCacheValue(seriesDetailCache.get(cacheKey))
  if (cached) {
    return cached
  }

  const payload = await requestOlympusJson<OlympusSeriesDetailResponse>(
    `/api/series/${encodeURIComponent(slug)}`,
    { type: 'comic' },
    signal,
  )

  seriesDetailCache.set(cacheKey, setCacheValue(payload.data))
  return payload.data
}

async function getOlympusSeriesChaptersPage(
  slug: string,
  page: number,
  signal?: AbortSignal,
): Promise<OlympusSeriesChaptersResponse> {
  return requestOlympusJson<OlympusSeriesChaptersResponse>(
    `/api/series/${encodeURIComponent(slug)}/chapters`,
    {
      page,
      direction: 'desc',
      type: 'comic',
    },
    signal,
  )
}

async function getOlympusAllSeriesChapters(
  manga: MangaSummary,
  signal?: AbortSignal,
): Promise<MangaChapterSummary[]> {
  const cacheKey = `series-chapters:${manga.slug}`
  const cached = getCacheValue(seriesChaptersCache.get(cacheKey))
  if (cached) {
    return cached
  }

  const firstPage = await getOlympusSeriesChaptersPage(manga.slug, 1, signal)
  const rawChapters = [...firstPage.data]

  if (firstPage.meta.last_page > 1) {
    for (let start = 2; start <= firstPage.meta.last_page; start += CHAPTERS_BATCH_SIZE) {
      if (signal?.aborted) {
        throw new ApiError('La solicitud fue cancelada.', 499)
      }

      const batchPages = Array.from(
        { length: Math.min(CHAPTERS_BATCH_SIZE, firstPage.meta.last_page - start + 1) },
        (_, index) => start + index,
      )
      const batch = await Promise.all(
        batchPages.map((page) => getOlympusSeriesChaptersPage(manga.slug, page, signal)),
      )

      for (const page of batch) {
        rawChapters.push(...page.data)
      }
    }
  }

  const chapters = rawChapters
    .map((chapter) => createOlympusChapterSummary(manga, chapter))
    .sort((left, right) => {
      return (
        chapterSortValue(left.shortTitle.replace(/^Capitulo\s+/i, ''), left.id) -
        chapterSortValue(right.shortTitle.replace(/^Capitulo\s+/i, ''), right.id)
      )
    })

  seriesChaptersCache.set(cacheKey, setCacheValue(chapters))
  return chapters
}

function extractMangaIdFromCover(cover: string, fallbackSlug: string): string {
  const match = cover.match(/\/storage\/comics\/covers\/(\d+)\//i)
  return match?.[1] ?? fallbackSlug
}

function parseRecentChapterGroups(html: string): OlympusRecentSeriesGroup[] {
  const groups = html
    .split('<div class="bg-gray-800 p-4 rounded-xl relative">')
    .slice(1)
    .map((chunk) => {
      const seriesMatch = chunk.match(/href="\/series\/comic-([^"]+)"[\s\S]*?src="([^"]+)"[\s\S]*?alt="([^"]+)"/i)
      if (!seriesMatch) {
        return null
      }

      const [, slug, rawCover, title] = seriesMatch
      const cover = decodeHtmlAttribute(rawCover)
      const mangaId = extractMangaIdFromCover(cover, slug)
      const manga: MangaSummary = {
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
      }

      const chapterPattern = /href="\/capitulo\/(\d+)\/comic-[^"]+"[\s\S]*?<div class="chapter-name[^"]*"[^>]*>\s*Capítulo\s*([^<]+)<\/div>[\s\S]*?<time datetime="([^"]+)"[^>]*>([^<]+)<\/time>/gi
      const chapters: MangaRecentChapter[] = []
      let match: RegExpExecArray | null

      while ((match = chapterPattern.exec(chunk))) {
        const [, chapterId, chapterNumber, , relativeTime] = match
        const cleanNumber = normalizeWhitespace(chapterNumber)
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
        })
      }

      if (chapters.length === 0) {
        return null
      }

      return {
        manga,
        chapters,
      }
    })
    .filter((group): group is OlympusRecentSeriesGroup => Boolean(group))

  return groups
}

async function getOlympusRecentChapterGroups(signal?: AbortSignal): Promise<OlympusRecentSeriesGroup[]> {
  const cached = getCacheValue(recentSeriesCache)
  if (cached) {
    return cached
  }

  const response = await requestText(`${OLYMPUS_BASE_URL}/capitulos`, signal, {
    headers: OLYMPUS_HTML_HEADERS,
  })
  const groups = parseRecentChapterGroups(response.bodyText)
  recentSeriesCache = setCacheValue(groups)
  return groups
}

async function getOlympusFullCatalog(signal?: AbortSignal): Promise<MangaSummary[]> {
  const cached = getCacheValue(fullCatalogCache)
  if (cached) {
    return cached
  }

  const firstPage = await getOlympusSeriesPage(1, signal)
  const items = [...firstPage.items]

  if (firstPage.lastPage > 1) {
    for (let start = 2; start <= firstPage.lastPage; start += FULL_CATALOG_BATCH_SIZE) {
      if (signal?.aborted) {
        throw new ApiError('La solicitud fue cancelada.', 499)
      }

      const batchPages = Array.from(
        { length: Math.min(FULL_CATALOG_BATCH_SIZE, firstPage.lastPage - start + 1) },
        (_, index) => start + index,
      )
      const batch = await Promise.all(batchPages.map((page) => getOlympusSeriesPage(page, signal)))
      for (const page of batch) {
        items.push(...page.items)
      }
    }
  }

  const deduped = dedupeSummaries(items)
  fullCatalogCache = setCacheValue(deduped, FULL_CATALOG_TTL_MS)
  return deduped
}

export function isOlympusMangaLibrary(libraryType: string): boolean {
  return libraryType.trim().toLowerCase() === 'comic'
}

export async function getOlympusMangaHome(signal?: AbortSignal): Promise<MangaHomeData> {
  const [seriesPage, recentGroups] = await Promise.all([
    getOlympusSeriesPage(1, signal),
    getOlympusRecentChapterGroups(signal),
  ])

  const featuredSeed = recentGroups[0]?.manga ?? seriesPage.items[0]
  if (!featuredSeed) {
    throw new ApiError('Olympus no devolvio series para la portada.', 502)
  }

  const featuredDetail = await getOlympusSeriesDetailRaw(featuredSeed.slug, signal)
  const featured = mapOlympusDetailToSummary(featuredDetail)
  const fallbackPage =
    seriesPage.lastPage > 1 && (seriesPage.items.length < 18 || seriesPage.recommended.length < 12)
      ? await getOlympusSeriesPage(2, signal)
      : null
  const recentChapters = dedupeRecentChapters(recentGroups.flatMap((group) => group.chapters)).slice(0, 18)
  const trending = dedupeSummaries([
    featured,
    ...seriesPage.items.filter((item) => item.slug !== featured.slug),
    ...(fallbackPage?.items ?? []).filter((item) => item.slug !== featured.slug),
  ]).slice(0, 18)
  const spotlight = dedupeSummaries([
    ...seriesPage.recommended,
    ...(fallbackPage?.recommended ?? []),
    ...seriesPage.items,
    ...(fallbackPage?.items ?? []),
  ])
    .filter((item) => item.slug !== featured.slug)
    .slice(0, 12)

  return {
    featured,
    trending,
    latestChapters: recentChapters,
    spotlight,
    source: 'olympus',
    notice: OLYMPUS_NOTICE,
  }
}

export async function searchOlympusManga(query: string, signal?: AbortSignal): Promise<MangaSummary[]> {
  const cleanQuery = query.trim().toLowerCase()

  if (!cleanQuery) {
    const preview = await getOlympusSeriesPage(1, signal)
    return dedupeSummaries(preview.items).slice(0, 24)
  }

  const catalog = await getOlympusFullCatalog(signal)
  return catalog.filter((manga) => {
    return (
      manga.title.toLowerCase().includes(cleanQuery) ||
      manga.slug.toLowerCase().includes(cleanQuery) ||
      manga.synopsis.toLowerCase().includes(cleanQuery)
    )
  })
}

export async function getOlympusMangaDetail(
  libraryType: string,
  id: string,
  slug: string,
  signal?: AbortSignal,
): Promise<MangaDetail> {
  if (!isOlympusMangaLibrary(libraryType)) {
    throw new ApiError('La serie no pertenece a Olympus.', 404)
  }

  const [detailRaw, seriesPage] = await Promise.all([
    getOlympusSeriesDetailRaw(slug, signal),
    getOlympusSeriesPage(1, signal),
  ])
  const summary = mapOlympusDetailToSummary(detailRaw)

  if (toIdString(detailRaw.id) !== id.trim()) {
    throw new ApiError('La serie solicitada no coincide con Olympus.', 404)
  }

  const chapters = await getOlympusAllSeriesChapters(summary, signal)
  const related = dedupeSummaries(
    seriesPage.recommended.filter((item) => item.id !== summary.id),
  ).slice(0, 8)

  return {
    ...summary,
    description: buildOlympusSynopsis(detailRaw.summary),
    alternativeTitles: detailRaw.note ? [normalizeWhitespace(detailRaw.note)] : [],
    chapters,
    related,
    notice: OLYMPUS_NOTICE,
  }
}

export async function getOlympusMangaReadData(
  libraryType: string,
  id: string,
  slug: string,
  chapterId: string,
  signal?: AbortSignal,
): Promise<MangaReadData> {
  if (!isOlympusMangaLibrary(libraryType)) {
    throw new ApiError('La serie no pertenece a Olympus.', 404)
  }

  const detailRaw = await getOlympusSeriesDetailRaw(slug, signal)
  const summary = mapOlympusDetailToSummary(detailRaw)

  if (toIdString(detailRaw.id) !== id.trim()) {
    throw new ApiError('La serie solicitada no coincide con Olympus.', 404)
  }

  const [chapters, chapterData] = await Promise.all([
    getOlympusAllSeriesChapters(summary, signal),
    getOlympusChapterData(
      {
        chapterId,
        slug,
        type: 'comic',
      },
      signal,
    ),
  ])

  const currentChapter =
    chapters.find((chapter) => chapter.id === chapterId.trim()) ??
    createOlympusChapterSummary(summary, {
      id: chapterData.chapter.id,
      name: chapterData.chapter.number,
    })

  return {
    manga: summary,
    chapter: currentChapter,
    chapters,
    pages: chapterData.chapter.pages,
    readingMode: chapterData.chapter.pages.length > 0 ? 'pages' : 'external',
    externalUrl: chapterData.chapterUrl,
    source: 'olympus',
    notice: OLYMPUS_NOTICE,
  }
}

function isNuxtRef(value: unknown, payload: NuxtPayload): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) < payload.length
}

function resolveNuxtValue(
  payload: NuxtPayload,
  value: unknown,
  stack = new Set<number>(),
): unknown {
  if (isNuxtRef(value, payload)) {
    const ref = Number(value)
    if (stack.has(ref)) {
      return payload[ref]
    }

    const target = payload[ref]
    if (target === null || typeof target !== 'object') {
      return target
    }

    const nextStack = new Set(stack)
    nextStack.add(ref)
    return resolveNuxtValue(payload, target, nextStack)
  }

  if (Array.isArray(value)) {
    const [tag, next] = value
    if (
      (tag === 'ShallowReactive' || tag === 'Reactive' || tag === 'Ref') &&
      value.length >= 2
    ) {
      return resolveNuxtValue(payload, next, stack)
    }

    return value.map((item) => resolveNuxtValue(payload, item, stack))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        resolveNuxtValue(payload, nestedValue, stack),
      ]),
    )
  }

  return value
}

function getChapterTarget(options: OlympusChapterOptions): {
  chapterId: string
  slug: string
  type: string
  chapterUrl: string
  payloadUrl: string
  routePath: string
} {
  const requestedType = options.type?.trim() || 'comic'

  if (options.chapterId?.trim() && options.slug?.trim()) {
    const chapterId = options.chapterId.trim()
    const slug = options.slug.trim()
    const chapterUrl = buildOlympusChapterUrl(slug, chapterId)
    const routePath = new URL(chapterUrl).pathname

    return {
      chapterId,
      slug,
      type: requestedType,
      chapterUrl,
      payloadUrl: `${chapterUrl}/_payload.json`,
      routePath,
    }
  }

  const rawUrl = options.chapterUrl?.trim() || options.payloadUrl?.trim()
  if (!rawUrl) {
    throw new ApiError(
      'Debes enviar payloadUrl, chapterUrl o chapterId + slug para consultar Olympus.',
      400,
    )
  }

  const parsed = new URL(rawUrl)
  const pathname = parsed.pathname.replace(/\/_payload\.json$/, '').replace(/\/$/, '')
  const match = pathname.match(/^\/capitulo\/([^/]+)\/([^/]+)$/i)

  if (!match) {
    throw new ApiError('La ruta del capitulo de Olympus no es valida.', 400)
  }

  const [, chapterId, routeSlug] = match
  let type = requestedType
  let slug = routeSlug
  const routeMatch = routeSlug.match(/^([a-z]+)-(.+)$/i)

  if (routeMatch) {
    const [, detectedType, detectedSlug] = routeMatch
    if (!options.type?.trim()) {
      type = detectedType.toLowerCase()
    }

    if (detectedType.toLowerCase() === type.toLowerCase()) {
      slug = detectedSlug
    }
  }

  const chapterUrl = buildSiteUrl(pathname)

  return {
    chapterId,
    slug,
    type,
    chapterUrl,
    payloadUrl: `${chapterUrl}/_payload.json`,
    routePath: pathname,
  }
}

async function requestOlympusChapterPayload(
  url: string,
  signal?: AbortSignal,
): Promise<NuxtPayload> {
  const response = await requestText(url, signal, {
    headers: OLYMPUS_HEADERS,
  })

  try {
    const payload = JSON.parse(response.bodyText) as NuxtPayload
    if (!Array.isArray(payload)) {
      throw new Error('Payload invalido')
    }

    return payload
  } catch {
    throw new ApiError('Olympus no devolvio un payload de capitulo valido.', 502)
  }
}

function resolveChapterPayloadData(
  payload: NuxtPayload,
  routePath: string,
): {
  chapter: Record<string, unknown> | null
  comic: Record<string, unknown> | null
  prevChapter: Record<string, unknown> | null
  nextChapter: Record<string, unknown> | null
} {
  const routeRecord = payload.find((item) => {
    return Boolean(item && typeof item === 'object' && !Array.isArray(item) && routePath in item)
  }) as Record<string, unknown> | undefined

  if (!routeRecord) {
    throw new ApiError('No pude ubicar la ruta del capitulo dentro del payload de Olympus.', 502)
  }

  const resolved = resolveNuxtValue(payload, routeRecord[routePath]) as Record<string, unknown> | null
  if (!resolved || typeof resolved !== 'object') {
    throw new ApiError('Olympus devolvio un payload de capitulo incompleto.', 502)
  }

  const chapter = resolved.chapter
  const comic = resolved.comic
  const prevChapter = resolved.prev_chapter
  const nextChapter = resolved.next_chapter

  return {
    chapter: chapter && typeof chapter === 'object' ? (chapter as Record<string, unknown>) : null,
    comic: comic && typeof comic === 'object' ? (comic as Record<string, unknown>) : null,
    prevChapter:
      prevChapter && typeof prevChapter === 'object'
        ? (prevChapter as Record<string, unknown>)
        : null,
    nextChapter:
      nextChapter && typeof nextChapter === 'object'
        ? (nextChapter as Record<string, unknown>)
        : null,
  }
}

function buildSeriesRouteSlug(type: string | null, seriesSlug: string | null): string | null {
  if (!seriesSlug) {
    return null
  }

  if (!type) {
    return seriesSlug
  }

  return seriesSlug.startsWith(`${type}-`) ? seriesSlug : `${type}-${seriesSlug}`
}

export async function getOlympusChapterData(
  options: OlympusChapterOptions,
  signal?: AbortSignal,
): Promise<OlympusChapterData> {
  const target = getChapterTarget(options)
  const payload = await requestOlympusChapterPayload(target.payloadUrl, signal)
  const { chapter, comic, prevChapter, nextChapter } = resolveChapterPayloadData(
    payload,
    target.routePath,
  )

  if (!chapter) {
    throw new ApiError('Olympus no devolvio la informacion del capitulo.', 502)
  }

  let recommendedSeries: unknown[] = []
  if (Array.isArray(chapter.recommended_series)) {
    recommendedSeries = chapter.recommended_series
  } else if (typeof chapter.recommended_series === 'string' && chapter.recommended_series.trim()) {
    try {
      recommendedSeries = JSON.parse(chapter.recommended_series) as unknown[]
    } catch {
      recommendedSeries = []
    }
  }

  const chapterType = readText(chapter.type) ?? target.type
  const seriesSlug = readText(comic?.slug) ?? target.slug
  const seriesName = readText(comic?.name)
  const seriesRouteSlug = buildSeriesRouteSlug(chapterType, seriesSlug)
  const chapterTitle = readText(chapter.title) ?? readText(chapter.name)
  const chapterNumber = readText(chapter.name) ?? '0'
  const pages = Array.isArray(chapter.pages)
    ? chapter.pages
        .map((page) => readText(page))
        .filter((pageUrl): pageUrl is string => Boolean(pageUrl))
    : []

  return {
    source: 'olympus',
    payloadUrl: target.payloadUrl,
    routePath: target.routePath,
    chapterUrl: target.chapterUrl,
    chapter: {
      id: (chapter.id as number | string | undefined) ?? '',
      number: chapterNumber,
      title: chapterTitle,
      publishedAt: readText(chapter.published_at),
      viewCount: readNumber(chapter.view_count),
      type: chapterType,
      pageCount: pages.length,
      pages,
      team:
        chapter.team && typeof chapter.team === 'object'
          ? (() => {
              const team = chapter.team as Record<string, unknown>

              return {
                id: (team.id as number | string | undefined) ?? '',
                name: readName(team.name) ?? 'Equipo desconocido',
                cover: readText(team.cover),
              }
            })()
          : null,
    },
    series:
      comic && seriesSlug && seriesName
        ? {
            id: (comic.id as number | string | undefined) ?? '',
            name: seriesName,
            slug: seriesSlug,
            url: buildSiteUrl(`/series/${seriesRouteSlug ?? seriesSlug}`),
          }
        : null,
    prevChapter:
      prevChapter && seriesRouteSlug
        ? {
            id: (prevChapter.id as number | string | undefined) ?? '',
            number: readText(prevChapter.name) ?? '',
            url: buildSiteUrl(
              `/capitulo/${String(prevChapter.id ?? '').trim()}/${seriesRouteSlug}`,
            ),
          }
        : null,
    nextChapter:
      nextChapter && seriesRouteSlug
        ? {
            id: (nextChapter.id as number | string | undefined) ?? '',
            number: readText(nextChapter.name) ?? '',
            url: buildSiteUrl(
              `/capitulo/${String(nextChapter.id ?? '').trim()}/${seriesRouteSlug}`,
            ),
          }
        : null,
    recommendedSeries: recommendedSeries
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null
        }

        const candidate = item as Record<string, unknown>
        const recommendedSlug = readText(candidate.slug)
        const recommendedType = readText(candidate.type)
        const recommendedName = readText(candidate.name)

        if (!recommendedSlug || !recommendedName) {
          return null
        }

        return {
          id: (candidate.id as number | string | undefined) ?? '',
          name: recommendedName,
          slug: recommendedSlug,
          status: readName(candidate.status),
          cover: readText(candidate.cover),
          type: recommendedType,
          url: buildSiteUrl(
            `/series/${buildSeriesRouteSlug(recommendedType, recommendedSlug) ?? recommendedSlug}`,
          ),
        }
      })
      .filter((item): item is OlympusChapterData['recommendedSeries'][number] => Boolean(item)),
  }
}

