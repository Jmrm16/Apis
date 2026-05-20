import { existsSync } from 'node:fs'
import { chromium, type Page } from 'playwright-core'
import { env } from '../config/env.js'
import { ApiError } from '../lib/http.js'
import type { EpisodeServer } from '../types/anime.js'
import type {
  DoramaCatalogPage,
  DoramaEpisodeCard,
  DoramaEpisodeDetail,
  DoramaEpisodeLink,
  DoramaHomeData,
  DoramaSeriesCard,
  DoramaSeriesDetail,
} from '../types/dorama.js'

const TUDORAMA_BASE_URL = 'https://tudorama.com'
const SCRAPER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
const COMMON_BROWSER_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/opt/google/chrome/chrome',
]

const HOME_CACHE_TTL_MS = 10 * 60 * 1000
const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000
const SERIES_CACHE_TTL_MS = 30 * 60 * 1000
const EPISODE_CACHE_TTL_MS = 15 * 60 * 1000

interface CachedEntry<T> {
  value: T
  expiresAt: number
}

const homeCache = new Map<string, CachedEntry<DoramaHomeData>>()
const catalogCache = new Map<string, CachedEntry<DoramaCatalogPage>>()
const seriesCache = new Map<string, CachedEntry<DoramaSeriesDetail>>()
const episodeCache = new Map<string, CachedEntry<DoramaEpisodeDetail>>()

function readCache<T>(cache: Map<string, CachedEntry<T>>, key: string): T | null {
  const entry = cache.get(key)

  if (!entry) {
    return null
  }

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key)
    return null
  }

  return entry.value
}

function writeCache<T>(cache: Map<string, CachedEntry<T>>, key: string, value: T, ttlMs: number): T {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  })

  return value
}

function normalizeText(value: string | null | undefined): string | null {
  const nextValue = value?.replace(/\s+/g, ' ').trim()
  return nextValue ? nextValue : null
}

function normalizeList(values: Array<string | null | undefined>): string[] {
  const unique = new Map<string, string>()

  for (const value of values) {
    const nextValue = normalizeText(value)
    if (!nextValue) {
      continue
    }

    const key = nextValue.toLowerCase()
    if (!unique.has(key)) {
      unique.set(key, nextValue)
    }
  }

  return Array.from(unique.values())
}

function normalizeImageUrl(value: string | null | undefined): string {
  const nextValue = normalizeText(value)
  if (!nextValue) {
    return ''
  }

  if (nextValue.startsWith('//')) {
    return `https:${nextValue}`
  }

  if (nextValue.startsWith('/')) {
    return `${TUDORAMA_BASE_URL}${nextValue}`
  }

  return nextValue
}

function buildSeriesUrl(slug: string): string {
  return `${TUDORAMA_BASE_URL}/serie/${encodeURIComponent(slug.trim())}/`
}

function buildEpisodeUrl(slug: string): string {
  return `${TUDORAMA_BASE_URL}/ver/${encodeURIComponent(slug.trim())}/`
}

function parseSlugFromUrl(url: string, segment: '/serie/' | '/ver/'): string | null {
  const normalizedUrl = normalizeText(url)
  if (!normalizedUrl) {
    return null
  }

  const markerIndex = normalizedUrl.indexOf(segment)
  if (markerIndex === -1) {
    return null
  }

  const slugValue = normalizedUrl
    .slice(markerIndex + segment.length)
    .replace(/\/+$/, '')
    .split('/')[0]
    .trim()

  return slugValue || null
}

function parseEpisodeNumbers(slug: string): { seasonNumber: number | null; episodeNumber: number | null } {
  const normalizedSlug = slug.trim().toLowerCase()
  const match = normalizedSlug.match(/-s(\d+)x(\d+)$/i)

  if (!match) {
    return {
      seasonNumber: null,
      episodeNumber: null,
    }
  }

  return {
    seasonNumber: Number.parseInt(match[1], 10) || null,
    episodeNumber: Number.parseInt(match[2], 10) || null,
  }
}

function toSeriesCard(value: {
  slug: string
  title: string
  poster?: string | null
  backdrop?: string | null
  synopsis?: string | null
  status?: string | null
  score?: string | null
  views?: string | null
  sourceUrl?: string | null
}): DoramaSeriesCard {
  return {
    slug: value.slug.trim(),
    title: normalizeText(value.title) ?? value.slug.trim(),
    poster: normalizeImageUrl(value.poster),
    backdrop: normalizeImageUrl(value.backdrop) || null,
    synopsis: normalizeText(value.synopsis),
    status: normalizeText(value.status),
    score: normalizeText(value.score),
    views: normalizeText(value.views),
    sourceUrl: normalizeText(value.sourceUrl) ?? buildSeriesUrl(value.slug),
  }
}

function findBrowserExecutablePath(): string {
  const configuredPath = env.browserExecutablePath.trim()
  if (configuredPath) {
    return configuredPath
  }

  const detectedPath = COMMON_BROWSER_PATHS.find((path) => existsSync(path))
  if (detectedPath) {
    return detectedPath
  }

  throw new ApiError(
    'No se encontro un navegador compatible para Tudorama. Configura BROWSER_EXECUTABLE_PATH.',
    500,
  )
}

async function preparePage(page: Page): Promise<void> {
  await page.route('**/*', (route) => {
    const request = route.request()
    const resourceType = request.resourceType()
    const url = request.url().toLowerCase()

    if (
      resourceType === 'image' ||
      resourceType === 'media' ||
      resourceType === 'font' ||
      url.includes('doubleclick') ||
      url.includes('googlesyndication') ||
      url.includes('googleadservices') ||
      url.includes('adnxs') ||
      url.includes('taboola') ||
      url.includes('outbrain')
    ) {
      return route.abort()
    }

    return route.continue()
  })
}

async function withTudoramaPage<T>(
  url: string,
  task: (page: Page) => Promise<T>,
): Promise<T> {
  const executablePath = findBrowserExecutablePath()
  const browser = await chromium.launch({
    executablePath,
    headless: env.browserHeadless,
    args: ['--disable-blink-features=AutomationControlled'],
  })

  try {
    const context = await browser.newContext({
      locale: 'es-CO',
      userAgent: SCRAPER_USER_AGENT,
      viewport: {
        width: 1440,
        height: 1600,
      },
      extraHTTPHeaders: {
        'accept-language': 'es-419,es;q=0.9,en;q=0.8',
      },
    })

    const page = await context.newPage()
    await preparePage(page)

    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    })

    if ((response?.status() ?? 0) >= 400) {
      throw new ApiError(response?.statusText() || 'Tudorama rechazo la solicitud.', response?.status() ?? 502)
    }

    await page.waitForTimeout(2_200)

    const title = await page.title()
    if (/403 forbidden/i.test(title)) {
      throw new ApiError('Tudorama bloqueo la solicitud del scraper.', 502)
    }

    return await task(page)
  } finally {
    await browser.close()
  }
}

function getCatalogUrl(page: number): string {
  return page > 1
    ? `${TUDORAMA_BASE_URL}/genero/series/page/${page}/`
    : `${TUDORAMA_BASE_URL}/genero/series/`
}

function getSearchUrl(query: string, page: number): string {
  const encodedQuery = encodeURIComponent(query.trim())

  return page > 1
    ? `${TUDORAMA_BASE_URL}/page/${page}/?s=${encodedQuery}`
    : `${TUDORAMA_BASE_URL}/?s=${encodedQuery}`
}

async function extractHomeData(page: Page): Promise<DoramaHomeData> {
  await page.waitForSelector('article.hero, article.ieps', { timeout: 20_000 })

  const payload = await page.evaluate(() => {
    const cleanText = (value?: string | null) => value?.replace(/\s+/g, ' ').trim() || null
    const cleanImage = (value?: string | null) => value?.trim() || null
    const getSlug = (url: string, marker: '/serie/' | '/ver/') => {
      const index = url.indexOf(marker)
      if (index === -1) {
        return null
      }

      const value = url
        .slice(index + marker.length)
        .replace(/\/+$/, '')
        .split('/')[0]
        .trim()

      return value || null
    }

    const featured = Array.from(document.querySelectorAll('article.hero'))
      .map((item) => {
        const link = item.querySelector<HTMLAnchorElement>('a[href*="/serie/"]')
        const image = item.querySelector<HTMLImageElement>('img')
        const sourceUrl = link?.href?.trim() || ''
        const slug = sourceUrl ? getSlug(sourceUrl, '/serie/') : null

        if (!slug || !sourceUrl) {
          return null
        }

        const title =
          cleanText(item.querySelector('h2')?.textContent) ||
          cleanText(image?.getAttribute('alt')) ||
          slug

        return {
          slug,
          title,
          poster: cleanImage(image?.getAttribute('src') || image?.getAttribute('data-src')),
          backdrop: cleanImage(image?.getAttribute('src') || image?.getAttribute('data-src')),
          synopsis: cleanText(item.querySelector('.hero__overview')?.textContent),
          status: null,
          score: cleanText(item.querySelector('.avg-score, .score')?.textContent),
          views: cleanText(item.querySelector('.hero__views, .views')?.textContent),
          sourceUrl,
        }
      })
      .filter(Boolean)

    const recentEpisodes = Array.from(document.querySelectorAll('article.ieps'))
      .map((item) => {
        const link = item.querySelector<HTMLAnchorElement>('a[href*="/ver/"]')
        const image = item.querySelector<HTMLImageElement>('img')
        const titleNode = item.querySelector('.ieps__title, h3')
        const sourceUrl = link?.href?.trim() || ''
        const slug = sourceUrl ? getSlug(sourceUrl, '/ver/') : null

        if (!slug || !sourceUrl) {
          return null
        }

        const seriesUrl =
          item.querySelector<HTMLAnchorElement>('a[href*="/serie/"]')?.href?.trim() ||
          item.querySelector<HTMLAnchorElement>('.ieps__title a')?.href?.trim() ||
          ''
        const seriesSlug = seriesUrl ? getSlug(seriesUrl, '/serie/') : slug.replace(/-s\d+x\d+$/i, '')
        const seriesTitle =
          cleanText(item.querySelector('.ieps__serie, .ieps__series')?.textContent) ||
          cleanText(titleNode?.textContent) ||
          seriesSlug ||
          slug
        const seasonText = cleanText(item.querySelector('.ssn')?.textContent)
        const episodeText = cleanText(item.querySelector('.num')?.textContent)

        return {
          slug,
          seriesSlug,
          seriesTitle,
          title: cleanText(titleNode?.textContent) || slug,
          seasonText,
          episodeText,
          runtime: cleanText(item.querySelector('.ieps__runtime, .runtime')?.textContent),
          poster: cleanImage(image?.getAttribute('src') || image?.getAttribute('data-src')),
          sourceUrl,
        }
      })
      .filter(Boolean)

    return {
      featured,
      recentEpisodes,
    }
  })

  const featuredItems = payload.featured.filter(
    (item): item is NonNullable<(typeof payload.featured)[number]> => Boolean(item),
  )
  const recentEpisodeItems = payload.recentEpisodes.filter(
    (item): item is NonNullable<(typeof payload.recentEpisodes)[number]> => Boolean(item),
  )

  return {
    featured: featuredItems.map((item) => toSeriesCard(item)),
    recentEpisodes: recentEpisodeItems.map((item) => {
      const inferredNumbers = parseEpisodeNumbers(item.slug)
      const seasonFromText = item.seasonText ? Number.parseInt(item.seasonText.replace(/\D+/g, ''), 10) : null
      const episodeFromText = item.episodeText ? Number.parseInt(item.episodeText.replace(/\D+/g, ''), 10) : null

      return {
        slug: item.slug,
        seriesSlug: item.seriesSlug || item.slug.replace(/-s\d+x\d+$/i, ''),
        seriesTitle: item.seriesTitle,
        title: item.title,
        seasonNumber: seasonFromText || inferredNumbers.seasonNumber,
        episodeNumber: episodeFromText || inferredNumbers.episodeNumber,
        runtime: item.runtime,
        poster: normalizeImageUrl(item.poster) || null,
        sourceUrl: item.sourceUrl,
      } satisfies DoramaEpisodeCard
    }),
  }
}

async function extractCatalogPage(page: Page, currentPage: number): Promise<DoramaCatalogPage> {
  await page.waitForSelector('article.ipst', { timeout: 20_000 })

  const payload = await page.evaluate(() => {
    const cleanText = (value?: string | null) => value?.replace(/\s+/g, ' ').trim() || null
    const cleanImage = (value?: string | null) => value?.trim() || null
    const getSlug = (url: string) => {
      const marker = '/serie/'
      const index = url.indexOf(marker)
      if (index === -1) {
        return null
      }

      const value = url
        .slice(index + marker.length)
        .replace(/\/+$/, '')
        .split('/')[0]
        .trim()

      return value || null
    }

    const items = Array.from(document.querySelectorAll('article.ipst'))
      .map((item) => {
        const link = item.querySelector<HTMLAnchorElement>('a[href*="/serie/"]')
        const image = item.querySelector<HTMLImageElement>('img')
        const sourceUrl = link?.href?.trim() || ''
        const slug = sourceUrl ? getSlug(sourceUrl) : null

        if (!slug || !sourceUrl) {
          return null
        }

        return {
          slug,
          title:
            cleanText(item.querySelector('.ipst__title, h3')?.textContent) ||
            cleanText(image?.getAttribute('alt')) ||
            slug,
          poster: cleanImage(
            image?.getAttribute('src') ||
              image?.getAttribute('data-src') ||
              image?.getAttribute('data-lazy-src'),
          ),
          backdrop: null,
          synopsis: cleanText(item.querySelector('.ipst__excerpt, .excerpt')?.textContent),
          status: null,
          score: cleanText(item.querySelector('.avg-score, .score')?.textContent),
          views: null,
          sourceUrl,
        }
      })
      .filter(Boolean)

    return {
      items,
      hasNextPage: Boolean(document.querySelector('.page-numbers.next')),
    }
  })

  const catalogItems = payload.items.filter(
    (item): item is NonNullable<(typeof payload.items)[number]> => Boolean(item),
  )

  return {
    page: currentPage,
    hasNextPage: payload.hasNextPage,
    items: catalogItems.map((item) => toSeriesCard(item)),
  }
}

async function extractSeriesDetail(page: Page, slug: string): Promise<DoramaSeriesDetail> {
  await page.waitForSelector('h2, .eps-list li.lep', { timeout: 20_000 })

  const payload = await page.evaluate(() => {
    const cleanText = (value?: string | null) => value?.replace(/\s+/g, ' ').trim() || null
    const cleanImage = (value?: string | null) => value?.trim() || null
    const normalizeList = (values: Array<string | null | undefined>) => {
      const unique = new Map<string, string>()

      for (const value of values) {
        const nextValue = cleanText(value)
        if (!nextValue) {
          continue
        }

        const key = nextValue.toLowerCase()
        if (!unique.has(key)) {
          unique.set(key, nextValue)
        }
      }

      return Array.from(unique.values())
    }
    const getSlug = (url: string, marker: '/ver/' | '/serie/') => {
      const index = url.indexOf(marker)
      if (index === -1) {
        return null
      }

      const value = url
        .slice(index + marker.length)
        .replace(/\/+$/, '')
        .split('/')[0]
        .trim()

      return value || null
    }

    const labelMap = new Map<string, string>()
    const labelSelectors = [
      '.hero__meta li',
      '.single__meta li',
      '.single__info li',
      '.postmeta li',
      '.infodetails li',
    ]

    for (const selector of labelSelectors) {
      const entries = Array.from(document.querySelectorAll(selector))
      for (const entry of entries) {
        const strong = cleanText(entry.querySelector('strong, b, .label, .title')?.textContent)
        const fullText = cleanText(entry.textContent)

        if (!fullText) {
          continue
        }

        const parts = fullText.split(':')
        if (strong && parts.length > 1) {
          labelMap.set(strong.toLowerCase(), cleanText(parts.slice(1).join(':')) || '')
          continue
        }

        if (parts.length > 1) {
          labelMap.set(parts[0].trim().toLowerCase(), cleanText(parts.slice(1).join(':')) || '')
        }
      }
    }

    const episodes = Array.from(document.querySelectorAll('.eps-list li.lep'))
      .map((item) => {
        const link = item.querySelector<HTMLAnchorElement>('a[href*="/ver/"]')
        const sourceUrl = link?.href?.trim() || ''
        const episodeSlug = sourceUrl ? getSlug(sourceUrl, '/ver/') : null

        if (!episodeSlug || !sourceUrl) {
          return null
        }

        return {
          slug: episodeSlug,
          title:
            cleanText(link?.querySelector('.lep__title, .title')?.textContent) ||
            cleanText(link?.textContent) ||
            episodeSlug,
          seasonNumber: Number.parseInt(item.getAttribute('data-season') || '', 10) || null,
          episodeNumber: Number.parseInt(item.getAttribute('data-episode') || '', 10) || null,
          runtime: cleanText(item.querySelector('.runtime, .lep__runtime')?.textContent),
          sourceUrl,
        }
      })
      .filter(Boolean)

    const title = cleanText(document.querySelector('h2')?.textContent)
    const posterImage = document.querySelector<HTMLImageElement>('.hero__poster img, .poster img, .single__poster img')
    const backdropImage = document.querySelector<HTMLImageElement>('.hero__backdrop img, .hero img')

    return {
      title,
      poster: cleanImage(
        posterImage?.getAttribute('src') ||
          posterImage?.getAttribute('data-src') ||
          posterImage?.getAttribute('data-lazy-src'),
      ),
      backdrop: cleanImage(
        backdropImage?.getAttribute('src') ||
          backdropImage?.getAttribute('data-src') ||
          backdropImage?.getAttribute('data-lazy-src'),
      ),
      synopsis:
        cleanText(document.querySelector('.hero__overview, .single__overview, .overview')?.textContent) ||
        cleanText(document.querySelector('meta[name="description"]')?.getAttribute('content')),
      status:
        cleanText(document.querySelector('.status, .hero__status')?.textContent) ||
        labelMap.get('estado') ||
        labelMap.get('status') ||
        null,
      score: cleanText(document.querySelector('.avg-score, .score')?.textContent),
      views: cleanText(document.querySelector('.hero__views, .views')?.textContent),
      originalTitle: labelMap.get('nombre original') || labelMap.get('titulo original') || null,
      alternativeTitles:
        cleanText(labelMap.get('titulos alternativos') || labelMap.get('titulo alternativo'))
          ?.split('/')
          .map((item) => cleanText(item))
          .filter(Boolean) || [],
      genres: Array.from(document.querySelectorAll('.hero__genres a, .genres a'))
        .map((item) => cleanText(item.textContent))
        .filter(Boolean),
      year: labelMap.get('ano') || labelMap.get('año') || labelMap.get('year') || null,
      releaseDate: labelMap.get('fecha de estreno') || labelMap.get('estreno') || null,
      seasonsLabel: labelMap.get('temporadas') || labelMap.get('seasons') || null,
      totalEpisodesLabel: labelMap.get('episodios') || labelMap.get('episodes') || null,
      duration: labelMap.get('duracion') || labelMap.get('duración') || labelMap.get('runtime') || null,
      directors: normalizeList([
        ...Array.from(document.querySelectorAll('.director a, .directors a')).map((item) => cleanText(item.textContent)),
        labelMap.get('director/es') || null,
        labelMap.get('director') || null,
      ]),
      cast: normalizeList([
        ...Array.from(document.querySelectorAll('.cast a, .reparto a, .elenco a')).map((item) => cleanText(item.textContent)),
        labelMap.get('elenco') || null,
        labelMap.get('reparto') || null,
      ]),
      episodes,
    }
  })

  const seriesEpisodes = payload.episodes.filter(
    (item): item is NonNullable<(typeof payload.episodes)[number]> => Boolean(item),
  )

  const episodes = seriesEpisodes
    .map((item) => {
      const inferred = parseEpisodeNumbers(item.slug)

      return {
        slug: item.slug,
        title: item.title,
        seasonNumber: item.seasonNumber ?? inferred.seasonNumber,
        episodeNumber: item.episodeNumber ?? inferred.episodeNumber,
        runtime: item.runtime,
        sourceUrl: item.sourceUrl,
      } satisfies DoramaEpisodeLink
    })
    .sort((left, right) => {
      const leftSeason = left.seasonNumber ?? 0
      const rightSeason = right.seasonNumber ?? 0
      const leftEpisode = left.episodeNumber ?? 0
      const rightEpisode = right.episodeNumber ?? 0

      if (leftSeason !== rightSeason) {
        return leftSeason - rightSeason
      }

      return leftEpisode - rightEpisode
    })

  return {
    ...toSeriesCard({
      slug,
      title: payload.title || slug,
      poster: payload.poster,
      backdrop: payload.backdrop,
      synopsis: payload.synopsis,
      status: payload.status,
      score: payload.score,
      views: payload.views,
      sourceUrl: buildSeriesUrl(slug),
    }),
    originalTitle: normalizeText(payload.originalTitle),
    alternativeTitles: normalizeList(payload.alternativeTitles),
    genres: normalizeList(payload.genres),
    year: normalizeText(payload.year),
    releaseDate: normalizeText(payload.releaseDate),
    seasonsLabel: normalizeText(payload.seasonsLabel),
    totalEpisodesLabel: normalizeText(payload.totalEpisodesLabel),
    duration: normalizeText(payload.duration),
    directors: normalizeList(payload.directors),
    cast: normalizeList(payload.cast),
    episodes,
  }
}

async function extractEpisodeDetail(page: Page, episodeSlug: string): Promise<DoramaEpisodeDetail> {
  await page.waitForSelector('.ep__dropdown, .hder-ep__title', { timeout: 20_000 })

  const payload = await page.evaluate(async () => {
    const cleanText = (value?: string | null) => value?.replace(/\s+/g, ' ').trim() || null
    const dropdown = document.querySelector<HTMLElement>('.ep__dropdown[data-id][data-nonce]')
    const episodeTitle =
      cleanText(document.querySelector('.hder-ep__title')?.textContent) ||
      cleanText(document.querySelector('h1')?.textContent)

    const seasonText = cleanText(document.querySelector('.season-number')?.textContent)
    const episodeText = cleanText(document.querySelector('.episode-number')?.textContent)
    const runtime = cleanText(document.querySelector('.runtime')?.textContent)
    const synopsis =
      cleanText(document.querySelector('.ep__overview, .single__overview, .overview')?.textContent) ||
      cleanText(document.querySelector('meta[name="description"]')?.getAttribute('content'))

    let servers: EpisodeServer[] = []

    if (dropdown?.dataset.id && dropdown?.dataset.nonce) {
      const formData = new FormData()
      formData.append('action', 'corvus_get_servers')
      formData.append('nonce', dropdown.dataset.nonce)
      formData.append('post_id', dropdown.dataset.id)

      const response = await fetch('/wp-admin/admin-ajax.php', {
        method: 'POST',
        body: formData,
        credentials: 'same-origin',
      })

      if (response.ok) {
        const json = await response.json().catch(() => [])
        if (Array.isArray(json)) {
          servers = json
            .map((item) => {
              const rawName =
                cleanText(item?.name) ||
                cleanText(item?.server) ||
                cleanText(item?.lang) ||
                'Servidor'
              const prefix = cleanText(item?.lang)
              const serverName = prefix && rawName && !rawName.toLowerCase().includes(prefix.toLowerCase())
                ? `${prefix} ${rawName}`
                : rawName

              return {
                name: serverName || 'Servidor',
                download: item?.type === 'download' ? cleanText(item?.url) : null,
                embed: cleanText(item?.url),
              } satisfies EpisodeServer
            })
            .filter((item) => Boolean(item.embed || item.download))
        }
      }
    }

    return {
      title: episodeTitle,
      seasonText,
      episodeText,
      runtime,
      synopsis,
      servers,
    }
  })

  const inferred = parseEpisodeNumbers(episodeSlug)
  const seasonNumber = payload.seasonText ? Number.parseInt(payload.seasonText.replace(/\D+/g, ''), 10) || null : null
  const episodeNumber = payload.episodeText ? Number.parseInt(payload.episodeText.replace(/\D+/g, ''), 10) || null : null

  return {
    slug: episodeSlug,
    title: payload.title || `Episodio ${episodeNumber ?? ''}`.trim(),
    seasonNumber: seasonNumber ?? inferred.seasonNumber,
    episodeNumber: episodeNumber ?? inferred.episodeNumber,
    runtime: normalizeText(payload.runtime),
    synopsis: normalizeText(payload.synopsis),
    sourceUrl: buildEpisodeUrl(episodeSlug),
    servers: payload.servers,
  }
}

export async function getTudoramaHome(signal?: AbortSignal): Promise<DoramaHomeData> {
  signal?.throwIfAborted()
  const cached = readCache(homeCache, 'home')
  if (cached) {
    return cached
  }

  const data = await withTudoramaPage(TUDORAMA_BASE_URL, (page) => extractHomeData(page))
  return writeCache(homeCache, 'home', data, HOME_CACHE_TTL_MS)
}

export async function getTudoramaCatalog(pageNumber = 1, signal?: AbortSignal): Promise<DoramaCatalogPage> {
  signal?.throwIfAborted()
  const safePage = Number.isFinite(pageNumber) && pageNumber > 0 ? Math.floor(pageNumber) : 1
  const cacheKey = `catalog:${safePage}`
  const cached = readCache(catalogCache, cacheKey)
  if (cached) {
    return cached
  }

  const data = await withTudoramaPage(getCatalogUrl(safePage), (page) => extractCatalogPage(page, safePage))
  return writeCache(catalogCache, cacheKey, data, CATALOG_CACHE_TTL_MS)
}

export async function searchTudoramaSeries(query: string, pageNumber = 1, signal?: AbortSignal): Promise<DoramaCatalogPage> {
  signal?.throwIfAborted()
  const normalizedQuery = query.trim()
  if (!normalizedQuery) {
    return getTudoramaCatalog(pageNumber, signal)
  }

  const safePage = Number.isFinite(pageNumber) && pageNumber > 0 ? Math.floor(pageNumber) : 1
  const cacheKey = `search:${normalizedQuery.toLowerCase()}:${safePage}`
  const cached = readCache(catalogCache, cacheKey)
  if (cached) {
    return cached
  }

  const data = await withTudoramaPage(getSearchUrl(normalizedQuery, safePage), (page) => extractCatalogPage(page, safePage))
  return writeCache(catalogCache, cacheKey, data, CATALOG_CACHE_TTL_MS)
}

export async function getTudoramaSeriesDetail(slug: string, signal?: AbortSignal): Promise<DoramaSeriesDetail> {
  signal?.throwIfAborted()
  const normalizedSlug = slug.trim()
  if (!normalizedSlug) {
    throw new ApiError('La serie solicitada no es valida.', 400)
  }

  const cacheKey = `series:${normalizedSlug.toLowerCase()}`
  const cached = readCache(seriesCache, cacheKey)
  if (cached) {
    return cached
  }

  const data = await withTudoramaPage(buildSeriesUrl(normalizedSlug), (page) => extractSeriesDetail(page, normalizedSlug))
  return writeCache(seriesCache, cacheKey, data, SERIES_CACHE_TTL_MS)
}

export async function getTudoramaEpisodeDetail(
  seriesSlug: string,
  episodeSlug: string,
  signal?: AbortSignal,
): Promise<DoramaEpisodeDetail> {
  signal?.throwIfAborted()
  const normalizedEpisodeSlug = episodeSlug.trim()
  if (!normalizedEpisodeSlug) {
    throw new ApiError('El episodio solicitado no es valido.', 400)
  }

  const cacheKey = `episode:${seriesSlug.trim().toLowerCase()}:${normalizedEpisodeSlug.toLowerCase()}`
  const cached = readCache(episodeCache, cacheKey)
  if (cached) {
    return cached
  }

  const data = await withTudoramaPage(buildEpisodeUrl(normalizedEpisodeSlug), (page) => extractEpisodeDetail(page, normalizedEpisodeSlug))
  return writeCache(episodeCache, cacheKey, data, EPISODE_CACHE_TTL_MS)
}
