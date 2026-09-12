import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ApiError } from '../lib/http.js'
import type {
  MangaChapterSummary,
  MangaDetail,
  MangaHomeData,
  MangaReadData,
  MangaSummary,
} from '../types/manga.js'

const IMPERIO_MANHUA_URL = 'https://imperiomanhua.com'
const COVER_PLACEHOLDER = 'https://placehold.co/600x900/111111/7dd3fc?text=ImperioManhua'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
const CACHE_TTL_MS = 5 * 60 * 1000
const DETAIL_TTL_MS = 12 * 60 * 1000
const HOME_LIMIT = 18
const SEARCH_LIMIT = 30
const MAX_HTML_BYTES = 6 * 1024 * 1024
const execFileAsync = promisify(execFile)

interface CacheEntry<T> {
  expiresAt: number
  value: T
}

interface ImperioChapterJson {
  id?: number | string
  num?: string | number
  name?: string
  url?: string
  ago?: string
  st?: string
  lk?: number | boolean
}

interface ImperioChapterPayload {
  items?: ImperioChapterJson[]
}

interface ImperioSeriesData {
  summary: MangaSummary
  description: string
  alternativeTitles: string[]
  chapters: MangaChapterSummary[]
}

let homeCache: CacheEntry<MangaHomeData> | null = null
const htmlCache = new Map<string, CacheEntry<string>>()
const detailCache = new Map<string, CacheEntry<ImperioSeriesData>>()
const searchCache = new Map<string, CacheEntry<MangaSummary[]>>()

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function cleanText(value: string): string {
  return normalizeWhitespace(
    decodeHtmlEntities(
      value
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' '),
    ),
  )
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => {
      const value = Number.parseInt(code, 16)
      return Number.isFinite(value) ? String.fromCodePoint(value) : ''
    })
    .replace(/&#(\d+);/g, (_, code: string) => {
      const value = Number.parseInt(code, 10)
      return Number.isFinite(value) ? String.fromCodePoint(value) : ''
    })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getAttribute(tag: string, attribute: string): string | null {
  const expression = new RegExp(
    "\\b" + escapeRegExp(attribute) + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'=<>`]+))",
    'i',
  )
  const match = tag.match(expression)
  const value = match?.[1] ?? match?.[2] ?? match?.[3]
  return value ? decodeHtmlEntities(value).trim() : null
}

function hasClass(tag: string, className: string): boolean {
  return (getAttribute(tag, 'class') ?? '').split(/\s+/).includes(className)
}

function firstTagTextByClass(html: string, className: string): string | null {
  const expression = /<([a-z][a-z0-9:-]*)\b([^>]*)>([\s\S]*?)<\/\1>/gi
  let match: RegExpExecArray | null

  while ((match = expression.exec(html)) !== null) {
    if (hasClass(match[2], className)) {
      const text = cleanText(match[3])
      if (text) return text
    }
  }

  return null
}

function titleCaseChapter(value: string): string {
  const normalized = normalizeWhitespace(value)
  if (!normalized) return 'Capítulo'
  return normalized.replace(/^capitulo\b/i, 'Capítulo')
}

function slugify(value: string): string {
  return decodeHtmlEntities(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}

function getCacheValue<T>(entry: CacheEntry<T> | null | undefined): T | null {
  if (!entry || entry.expiresAt <= Date.now()) return null
  return entry.value
}

function cacheValue<T>(value: T, ttlMs = CACHE_TTL_MS): CacheEntry<T> {
  return { value, expiresAt: Date.now() + ttlMs }
}

function validatePathSegment(value: string, label: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9_-]{0,119}$/.test(normalized)) {
    throw new ApiError(`El ${label} de ImperioManhua no es válido.`, 400)
  }
  return normalized
}

function makeSeriesUrl(id: string): string {
  return `${IMPERIO_MANHUA_URL}/manga/${encodeURIComponent(id)}/`
}

function makeChapterUrl(id: string, chapterId: string): string {
  return `${makeSeriesUrl(id)}${encodeURIComponent(chapterId)}/`
}

function toImperioUrl(value: string | null | undefined, base = IMPERIO_MANHUA_URL): string | null {
  if (!value?.trim()) return null

  try {
    const url = new URL(value, base)
    if (
      url.protocol !== 'https:' ||
      url.hostname.toLowerCase() !== 'imperiomanhua.com' ||
      url.port ||
      url.username ||
      url.password
    ) {
      return null
    }
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function getMetaContent(html: string, property: string): string | null {
  const expression = /<meta\b[^>]*>/gi
  let match: RegExpExecArray | null

  while ((match = expression.exec(html)) !== null) {
    const tag = match[0]
    const key = (getAttribute(tag, 'property') ?? getAttribute(tag, 'name') ?? '').toLowerCase()
    if (key === property.toLowerCase()) {
      return getAttribute(tag, 'content')
    }
  }

  return null
}

function getImageSource(tag: string): string | null {
  return (
    getAttribute(tag, 'data-src') ??
    getAttribute(tag, 'data-lazy-src') ??
    getAttribute(tag, 'src') ??
    null
  )
}

function parseSeriesLocation(value: string | null | undefined): { id: string; sourceUrl: string } | null {
  const sourceUrl = toImperioUrl(value)
  if (!sourceUrl) return null

  const url = new URL(sourceUrl)
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 2 || parts[0] !== 'manga') return null

  try {
    return {
      id: validatePathSegment(decodeURIComponent(parts[1]), 'identificador'),
      sourceUrl: makeSeriesUrl(decodeURIComponent(parts[1])),
    }
  } catch {
    return null
  }
}

function parseChapterLocation(
  value: string | null | undefined,
  expectedMangaId: string,
): { id: string; sourceUrl: string } | null {
  const sourceUrl = toImperioUrl(value)
  if (!sourceUrl) return null

  const url = new URL(sourceUrl)
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 3 || parts[0] !== 'manga' || parts[1].toLowerCase() !== expectedMangaId) {
    return null
  }

  try {
    const id = validatePathSegment(decodeURIComponent(parts[2]), 'capítulo')
    return { id, sourceUrl: makeChapterUrl(expectedMangaId, id) }
  } catch {
    return null
  }
}

function dedupeText(values: string[]): string[] {
  const unique = new Map<string, string>()
  for (const value of values) {
    const text = normalizeWhitespace(value)
    const key = text.toLocaleLowerCase('es')
    if (text && !unique.has(key)) unique.set(key, text)
  }
  return Array.from(unique.values())
}

function isImageUrl(value: string | null): value is string {
  if (!value) return false
  const url = new URL(value)
  return (
    url.hostname.toLowerCase() === 'imperiomanhua.com' &&
    url.pathname.startsWith('/wp-content/uploads/') &&
    /\.(?:jpe?g|png|webp|avif|gif)$/i.test(url.pathname)
  )
}

function parseCardCover(cardHtml: string): string {
  const expression = /<img\b[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = expression.exec(cardHtml)) !== null) {
    const imageUrl = toImperioUrl(getImageSource(match[0]))
    if (isImageUrl(imageUrl)) return imageUrl
  }
  return COVER_PLACEHOLDER
}

function parseCards(html: string, limit: number): MangaSummary[] {
  const expression = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  const results: MangaSummary[] = []
  const seen = new Set<string>()
  let match: RegExpExecArray | null

  while ((match = expression.exec(html)) !== null && results.length < limit) {
    const attributes = match[1]
    if (!hasClass(attributes, 'acard')) continue

    const location = parseSeriesLocation(getAttribute(attributes, 'href'))
    if (!location || seen.has(location.id)) continue

    const imageTitle = (() => {
      const imageMatch = match[2].match(/<img\b[^>]*>/i)
      return imageMatch ? getAttribute(imageMatch[0], 'alt') : null
    })()
    const title =
      cleanText(getAttribute(attributes, 'title') ?? '') ||
      cleanText(imageTitle ?? '') ||
      cleanText(match[2]) ||
      location.id

    seen.add(location.id)
    results.push({
      id: location.id,
      slug: slugify(title) || location.id,
      libraryType: 'manhua',
      title,
      cover: parseCardCover(match[2]),
      synopsis: 'Abre la ficha para ver la información y los capítulos disponibles en ImperioManhua.',
      status: 'En curso',
      demography: 'Manhua',
      rating: '',
      genres: [],
      chapterCount: 0,
      sourceUrl: location.sourceUrl,
      source: 'imperiomanhua',
    })
  }

  return results
}

function parseGenres(html: string): string[] {
  const genresSection = html.match(/<div\b[^>]*class=(?:"[^"]*\bhchips--genres\b[^"]*"|'[^']*\bhchips--genres\b[^']*')[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? html
  const expression = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  const genres: string[] = []
  let match: RegExpExecArray | null
  while ((match = expression.exec(genresSection)) !== null) {
    if (hasClass(match[1], 'chip')) {
      const genre = cleanText(match[2])
      if (genre) genres.push(genre)
    }
  }
  return dedupeText(genres)
}

function parseAlternativeTitles(html: string, currentTitle: string): string[] {
  const expression = /<([a-z][a-z0-9:-]*)\b([^>]*)>([\s\S]*?)<\/\1>/gi
  const alternatives: string[] = []
  let match: RegExpExecArray | null
  while ((match = expression.exec(html)) !== null) {
    const classes = getAttribute(match[2], 'class') ?? ''
    if (!/\bhmeta--alt\b|\balternative\b/i.test(classes)) continue
    const text = cleanText(match[3])
    if (text) alternatives.push(...text.split(/\s*\/\s*|\s*\|\s*/))
  }
  return dedupeText(alternatives).filter((title) => title.toLowerCase() !== currentTitle.toLowerCase())
}

function parseChaptersFromJson(html: string, manga: MangaSummary): MangaChapterSummary[] {
  const raw = html.match(/<script\b[^>]*id=(?:"mk-chapters-data"|'mk-chapters-data')[^>]*>([\s\S]*?)<\/script>/i)?.[1]
  if (!raw?.trim()) return []

  let payload: ImperioChapterPayload
  try {
    payload = JSON.parse(raw) as ImperioChapterPayload
  } catch {
    return []
  }

  const chapters: MangaChapterSummary[] = []
  for (const item of payload.items ?? []) {
    const state = String(item.st ?? '').trim().toLowerCase()
    const locked = item.lk === true || Number(item.lk) > 0 || state === 'locked'
    if (locked) continue

    const location = parseChapterLocation(item.url, manga.id)
    if (!location) continue
    const number = String(item.num ?? '').trim()
    const shortTitle = titleCaseChapter(String(item.name ?? (number ? `Capítulo ${number}` : location.id)))
    chapters.push({
      id: location.id,
      slug: location.id,
      title: `${manga.title} - ${shortTitle}`,
      numberLabel: number ? `Capítulo ${number}` : shortTitle,
      shortTitle,
      cover: manga.cover,
      sourceUrl: location.sourceUrl,
      publishedAt: null,
    })
  }

  return chapters
}

function parseChaptersFromLinks(html: string, manga: MangaSummary): MangaChapterSummary[] {
  const expression = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  const chapters: MangaChapterSummary[] = []
  const seen = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = expression.exec(html)) !== null) {
    if (!hasClass(match[1], 'crow')) continue
    const location = parseChapterLocation(getAttribute(match[1], 'href'), manga.id)
    if (!location || seen.has(location.id)) continue
    const shortTitle = titleCaseChapter(cleanText(match[2]) || location.id.replace(/-/g, ' '))
    const number = shortTitle.match(/\d+(?:\.\d+)?/)?.[0]
    seen.add(location.id)
    chapters.push({
      id: location.id,
      slug: location.id,
      title: `${manga.title} - ${shortTitle}`,
      numberLabel: number ? `Capítulo ${number}` : shortTitle,
      shortTitle,
      cover: manga.cover,
      sourceUrl: location.sourceUrl,
      publishedAt: null,
    })
  }
  return chapters
}

function sortChapters(chapters: MangaChapterSummary[]): MangaChapterSummary[] {
  return [...chapters].sort((left, right) => {
    const leftNumber = Number(left.numberLabel.match(/\d+(?:\.\d+)?/)?.[0])
    const rightNumber = Number(right.numberLabel.match(/\d+(?:\.\d+)?/)?.[0])
    const leftValue = Number.isFinite(leftNumber) ? leftNumber : Number.MAX_SAFE_INTEGER
    const rightValue = Number.isFinite(rightNumber) ? rightNumber : Number.MAX_SAFE_INTEGER
    return leftValue - rightValue || left.shortTitle.localeCompare(right.shortTitle, 'es')
  })
}

function parseSeries(html: string, id: string): ImperioSeriesData {
  const sourceUrl = makeSeriesUrl(id)
  const title = [
    firstTagTextByClass(html, 'htitle'),
    cleanText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? ''),
    cleanText(getMetaContent(html, 'og:title') ?? ''),
  ].find((value) => Boolean(value)) ?? id
  const cover = (() => {
    const ogImage = toImperioUrl(getMetaContent(html, 'og:image'))
    if (isImageUrl(ogImage)) return ogImage
    const images = html.match(/<img\b[^>]*>/gi) ?? []
    for (const image of images) {
      const imageUrl = toImperioUrl(getImageSource(image))
      if (isImageUrl(imageUrl)) return imageUrl
    }
    return COVER_PLACEHOLDER
  })()
  const metaDescription = cleanText(getMetaContent(html, 'description') ?? '')
  const summary: MangaSummary = {
    id,
    slug: slugify(title) || id,
    libraryType: 'manhua',
    title,
    cover,
    synopsis: metaDescription
      ? metaDescription.length > 260
        ? `${metaDescription.slice(0, 257).trim()}...`
        : metaDescription
      : 'Ficha disponible desde ImperioManhua.',
    status: firstTagTextByClass(html, 'htag--status') ?? 'En curso',
    demography: 'Manhua',
    rating: '',
    genres: parseGenres(html),
    chapterCount: 0,
    sourceUrl,
    source: 'imperiomanhua',
  }
  const chapters = sortChapters([
    ...parseChaptersFromJson(html, summary),
    ...parseChaptersFromLinks(html, summary),
  ].filter((chapter, index, all) => all.findIndex((item) => item.id === chapter.id) === index))

  return {
    summary: { ...summary, chapterCount: chapters.length },
    description: metaDescription || 'ImperioManhua no publicó una descripción completa para esta obra.',
    alternativeTitles: parseAlternativeTitles(html, title),
    chapters,
  }
}

function parseChapterPages(html: string): string[] {
  const expression = /<img\b[^>]*>/gi
  const pages: string[] = []
  const seen = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = expression.exec(html)) !== null) {
    if (!hasClass(match[0], 'wp-manga-chapter-img')) continue
    const page = toImperioUrl(getImageSource(match[0]))
    if (!isImageUrl(page) || !page.includes('/WP-manga/data/')) continue
    if (!seen.has(page)) {
      seen.add(page)
      pages.push(page)
    }
  }
  return pages
}

async function requestTextWithCurl(url: string): Promise<string> {
  const { stdout } = await execFileAsync(
    process.platform === 'win32' ? 'curl.exe' : 'curl',
    [
      '--fail',
      '--silent',
      '--show-error',
      '--location',
      '--max-time',
      '20',
      '--user-agent',
      USER_AGENT,
      '--header',
      'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      '--header',
      `Referer: ${IMPERIO_MANHUA_URL}/`,
      url,
    ],
    { encoding: 'utf8', maxBuffer: MAX_HTML_BYTES, windowsHide: true },
  )
  return stdout
}

async function requestText(path: string, signal?: AbortSignal): Promise<string> {
  const url = new URL(path, IMPERIO_MANHUA_URL)
  if (url.origin !== IMPERIO_MANHUA_URL) {
    throw new ApiError('La dirección de ImperioManhua no es válida.', 400)
  }
  const key = url.toString()
  const cached = getCacheValue(htmlCache.get(key))
  if (cached) return cached

  const timeout = AbortSignal.timeout(12_000)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  let text: string | null = null
  let status = 502
  try {
    const response = await fetch(key, {
      redirect: 'error',
      signal: requestSignal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'es-419,es;q=0.9,en;q=0.8',
        Referer: `${IMPERIO_MANHUA_URL}/`,
        'User-Agent': USER_AGENT,
      },
    })
    status = response.status
    if (response.ok) {
      text = await response.text()
    } else {
      await response.body?.cancel()
    }
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }
  }

  if (!text?.trim()) {
    try {
      text = await requestTextWithCurl(key)
    } catch {
      const errorStatus = status === 404 ? 404 : 502
      throw new ApiError(
        errorStatus === 404
          ? 'ImperioManhua no encontró este contenido.'
          : 'ImperioManhua no pudo entregar el contenido solicitado.',
        errorStatus,
      )
    }
  }

  if (!text.trim()) {
    throw new ApiError('ImperioManhua devolvió una página vacía.', 502)
  }
  htmlCache.set(key, cacheValue(text))
  return text
}

async function getSeriesData(id: string, signal?: AbortSignal): Promise<ImperioSeriesData> {
  const normalizedId = validatePathSegment(id, 'identificador')
  const cached = getCacheValue(detailCache.get(normalizedId))
  if (cached) return cached

  const html = await requestText(`/manga/${encodeURIComponent(normalizedId)}/`, signal)
  const data = parseSeries(html, normalizedId)
  if (!data.summary.title || data.chapters.length === 0 && !html.includes('mk-chapters-data')) {
    throw new ApiError('No pude interpretar la ficha de ImperioManhua.', 502)
  }
  detailCache.set(normalizedId, cacheValue(data, DETAIL_TTL_MS))
  return data
}

function dedupeSummaries(items: MangaSummary[]): MangaSummary[] {
  const unique = new Map<string, MangaSummary>()
  for (const item of items) unique.set(item.id, item)
  return Array.from(unique.values())
}

async function getCatalogOrder(order: 'trending' | 'views' | 'latest', signal?: AbortSignal): Promise<MangaSummary[]> {
  const html = await requestText(`/manga/?m_orderby=${order}`, signal)
  return parseCards(html, HOME_LIMIT)
}

export async function getImperioManhuaMangaHome(signal?: AbortSignal): Promise<MangaHomeData> {
  const cached = getCacheValue(homeCache)
  if (cached) return cached

  const results = await Promise.allSettled([
    getCatalogOrder('trending', signal),
    getCatalogOrder('views', signal),
    getCatalogOrder('latest', signal),
  ])
  const collections = results
    .filter((result): result is PromiseFulfilledResult<MangaSummary[]> => result.status === 'fulfilled')
    .map((result) => result.value)
  const [trending = [], popular = [], latest = []] = collections
  const all = dedupeSummaries([...trending, ...popular, ...latest])
  const featured = all[0]
  if (!featured) {
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    throw failure?.reason instanceof Error
      ? failure.reason
      : new ApiError('ImperioManhua no devolvió obras para el catálogo.', 502)
  }

  const home: MangaHomeData = {
    featured,
    trending: dedupeSummaries([...trending, ...popular]).slice(0, HOME_LIMIT),
    latestChapters: [],
    spotlight: dedupeSummaries([...latest, ...popular])
      .filter((item) => item.id !== featured.id)
      .slice(0, HOME_LIMIT),
    source: 'imperiomanhua',
    notice: 'ImperioManhua se lee dentro de AnimeNow. Solo se muestran capítulos de acceso libre.',
  }
  homeCache = cacheValue(home)
  return home
}

export async function searchImperioManhuaManga(query: string, signal?: AbortSignal): Promise<MangaSummary[]> {
  const cleanQuery = normalizeWhitespace(query).slice(0, 100)
  if (!cleanQuery) {
    const home = await getImperioManhuaMangaHome(signal)
    return dedupeSummaries([...home.trending, ...home.spotlight])
  }
  const cacheKey = cleanQuery.toLocaleLowerCase('es')
  const cached = getCacheValue(searchCache.get(cacheKey))
  if (cached) return cached

  const search = new URL('/', IMPERIO_MANHUA_URL)
  search.searchParams.set('s', cleanQuery)
  search.searchParams.set('post_type', 'wp-manga')
  const html = await requestText(`${search.pathname}${search.search}`, signal)
  const results = parseCards(html, SEARCH_LIMIT)
  searchCache.set(cacheKey, cacheValue(results))
  return results
}

export async function getImperioManhuaMangaDetail(
  id: string,
  _slug: string,
  signal?: AbortSignal,
): Promise<MangaDetail> {
  const data = await getSeriesData(id, signal)
  const related = await getImperioManhuaMangaHome(signal)
    .then((home) => dedupeSummaries([...home.trending, ...home.spotlight]))
    .catch(() => [])

  return {
    ...data.summary,
    description: data.description,
    alternativeTitles: data.alternativeTitles,
    chapters: data.chapters,
    related: related.filter((item) => item.id !== data.summary.id).slice(0, 8),
    notice: 'Los capítulos bloqueados por la fuente no se listan. Los capítulos libres se abren en el lector de AnimeNow.',
  }
}

export async function getImperioManhuaMangaReadData(
  id: string,
  slug: string,
  chapterId: string,
  signal?: AbortSignal,
): Promise<MangaReadData> {
  const normalizedId = validatePathSegment(id, 'identificador')
  const normalizedChapterId = validatePathSegment(chapterId, 'capítulo')
  const detail = await getImperioManhuaMangaDetail(normalizedId, slug, signal)
  const chapter = detail.chapters.find((item) => item.id === normalizedChapterId)
  if (!chapter) {
    throw new ApiError('Este capítulo no está disponible de forma libre en ImperioManhua.', 404)
  }

  const html = await requestText(
    `/manga/${encodeURIComponent(normalizedId)}/${encodeURIComponent(normalizedChapterId)}/`,
    signal,
  )
  const pages = parseChapterPages(html)
  if (pages.length === 0) {
    throw new ApiError('ImperioManhua no entregó páginas legibles para este capítulo.', 502)
  }

  return {
    manga: detail,
    chapter,
    chapters: detail.chapters,
    pages,
    readingMode: 'pages',
    externalUrl: chapter.sourceUrl,
    source: 'imperiomanhua',
    notice: 'Lectura interna de AnimeNow desde las páginas libres de ImperioManhua.',
  }
}


