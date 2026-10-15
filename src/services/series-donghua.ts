import { createContext, runInContext } from 'node:vm'
import { ApiError, requestText } from '../lib/http.js'
import type {
  AnimeDetail,
  AnimeEpisodeLink,
  AnimeSummary,
  EpisodeDetail,
  EpisodeSummary,
  SearchResultPage,
} from '../types/anime.js'

const SERIES_DONGHUA_BASE_URL = 'https://seriesdonghua.com'
const SERIES_DONGHUA_ON_AIR_URL = `${SERIES_DONGHUA_BASE_URL}/donghuas-en-emision`
const SERIES_DONGHUA_CATALOG_URL = `${SERIES_DONGHUA_BASE_URL}/todos-los-donghuas`
const SERIES_DONGHUA_RECENT_URL = `${SERIES_DONGHUA_BASE_URL}/episodios`

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ')
}

function normalizeText(value: string): string {
  return decodeHtmlEntities(stripTags(value)).replace(/\s+/g, ' ').trim()
}

function readAttribute(tag: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return tag.match(new RegExp(`${escapedName}=["']([^"']+)["']`, 'i'))?.[1]?.trim() ?? ''
}

function extractCardBlocks(html: string, requiredClass = 'donghua-card'): string[] {
  return Array.from(html.matchAll(/<article\b[^>]*class=["']([^"']*)["'][^>]*>[\s\S]*?<\/article>/gi))
    .filter((match) => match[1]?.split(/\s+/).includes(requiredClass))
    .map((match) => match[0])
}

function toAbsoluteUrl(value: string): string {
  return new URL(value, SERIES_DONGHUA_BASE_URL).toString()
}

function extractSlug(value: string): string {
  try {
    const parsed = new URL(value, SERIES_DONGHUA_BASE_URL)
    return parsed.pathname.replace(/^\/+|\/+$/g, '')
  } catch {
    return value.replace(/^\/+|\/+$/g, '')
  }
}

function buildSeriesUrl(slug: string): string {
  return `${SERIES_DONGHUA_BASE_URL}/${slug.replace(/^\/+|\/+$/g, '')}/`
}

function buildEpisodeUrl(slug: string, number: number): string {
  return `${SERIES_DONGHUA_BASE_URL}/${slug.replace(/^\/+|\/+$/g, '')}-episodio-${number}/`
}

function buildEpisodeUrlFromIdentifier(identifier: string): string {
  return `${SERIES_DONGHUA_BASE_URL}/${identifier.replace(/^\/+|\/+$/g, '')}/`
}

function withPageParam(url: string, page: number): string {
  if (page <= 1) {
    return url
  }

  const parsed = new URL(url)
  parsed.searchParams.set('pag', String(page))
  return parsed.toString()
}

function extractFirstNumber(value: string): number | null {
  const match = value.match(/(\d+(?:\.\d+)?)/)
  if (!match) {
    return null
  }

  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

function extractEpisodeNumber(value: string): number | null {
  const normalized = normalizeText(value)

  if (!normalized) {
    return null
  }

  const explicitEpisodeMatch = normalized.match(/(?:episodio|episode|capitulo|capi?tulo)[-\s_]*(\d+(?:\.\d+)?)/i)
  if (explicitEpisodeMatch) {
    const parsed = Number(explicitEpisodeMatch[1])
    return Number.isFinite(parsed) ? parsed : null
  }

  const numericTokens = normalized.match(/\d+(?:\.\d+)?/g)
  if (!numericTokens?.length) {
    return null
  }

  const parsed = Number(numericTokens[numericTokens.length - 1])
  return Number.isFinite(parsed) ? parsed : null
}

function sortEpisodes(episodes: AnimeEpisodeLink[]): AnimeEpisodeLink[] {
  return [...episodes].sort((left, right) => left.number - right.number)
}

function parsePlatformLabels(html: string): Map<string, string> {
  const platformLabels = new Map<string, string>()
  const platformPattern = /<li id="([^"]+)_tab"[\s\S]*?<a[^>]+href="#([^"]+)"[^>]*>[\s\S]*?<\/i>\s*([^<]+?)(?:\s*<span|\s*<\/a>)/g

  for (const match of html.matchAll(platformPattern)) {
    const [, idPlatform = '', hrefPlatform = '', rawLabel = ''] = match
    const platform = hrefPlatform || idPlatform
    const label = normalizeText(rawLabel)

    if (platform && label) {
      platformLabels.set(platform, label)
    }
  }

  return platformLabels
}

function unpackPlayerScript(html: string): string | null {
  const packedScriptMatch = html.match(
    /<script>var _0x[a-f0-9]+=.*?eval\(function\(h,u,n,t,e,r\)\{[\s\S]*?<\/script>/i,
  )

  if (!packedScriptMatch) {
    return null
  }

  let script = packedScriptMatch[0].replace(/^<script>/, '').replace(/<\/script>$/, '')
  const evalPrefix = 'eval(function(h,u,n,t,e,r){'

  if (!script.includes(evalPrefix)) {
    return null
  }

  script = script.replace(evalPrefix, 'globalThis.__decoded=(function(h,u,n,t,e,r){')
  script = script.replace(/\)\)\s*$/, '));')

  const context = {
    globalThis: {} as Record<string, unknown>,
  }

  createContext(context)
  runInContext(script, context)

  const decoded = context.globalThis.__decoded
  return typeof decoded === 'string' ? decoded : null
}

function parseVideoMap(unpackedScript: string): Record<string, string> {
  const match = unpackedScript.match(/VIDEO_MAP_JSON\s*=\s*(\{[\s\S]*?\})\s*;/)

  if (!match) {
    return {}
  }

  const normalizedJson = match[1].replace(/(?<!\\)\\"/g, '"')
  const rawMap = JSON.parse(normalizedJson) as Record<string, string>
  const normalizedMap: Record<string, string> = {}

  for (const [platform, encodedValue] of Object.entries(rawMap)) {
    try {
      const innerJson = encodedValue.replace(/\\"/g, '"')
      const decodedValue = JSON.parse(innerJson) as string
      if (decodedValue) {
        normalizedMap[platform] = decodedValue.split('\\/').join('/')
      }
    } catch {
      continue
    }
  }

  return normalizedMap
}

interface ModernPlayerOption {
  name: string
  videoId: number
  serverIndex: number
}

function parseModernPlayerOptions(html: string): ModernPlayerOption[] {
  const options: ModernPlayerOption[] = []

  for (const match of html.matchAll(/<button\b[^>]*class=["'][^"']*server-tab-btn[^"']*["'][^>]*>[\s\S]*?<\/button>/gi)) {
    const button = match[0]
    const openingTag = button.match(/<button\b[^>]*>/i)?.[0] ?? ''
    const videoId = Number(readAttribute(openingTag, 'data-video-id'))
    const serverIndex = Number(readAttribute(openingTag, 'data-server-index'))
    const name = normalizeText(
      button.match(/<span(?![^>]*server-badge)[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '',
    )

    if (!name || !Number.isFinite(videoId) || !Number.isFinite(serverIndex)) {
      continue
    }

    options.push({ name, videoId, serverIndex })
  }

  return options
}

function buildCookieHeader(headers: Headers): string {
  const extendedHeaders = headers as Headers & { getSetCookie?: () => string[] }
  const cookieValues = extendedHeaders.getSetCookie?.() ?? [headers.get('set-cookie') ?? '']

  return cookieValues
    .map((value) => value.split(';', 1)[0]?.trim())
    .filter(Boolean)
    .join('; ')
}

async function resolveModernPlayerServers(
  html: string,
  pageResponse: Response,
  pageUrl: string,
  signal?: AbortSignal,
): Promise<EpisodeDetail['servers']> {
  const csrfToken = html.match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i)?.[1]?.trim()
  const options = parseModernPlayerOptions(html)

  if (!csrfToken || options.length === 0) {
    return []
  }

  const cookieHeader = buildCookieHeader(pageResponse.headers)
  const results = await Promise.allSettled(
    options.map(async (option) => {
      const response = await fetch(`${SERIES_DONGHUA_BASE_URL}/api/player/get-server`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-CSRF-TOKEN': csrfToken,
          'X-Requested-With': 'XMLHttpRequest',
          Origin: SERIES_DONGHUA_BASE_URL,
          Referer: pageUrl,
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        body: JSON.stringify({
          video_id: option.videoId,
          server_index: option.serverIndex,
        }),
        signal,
      })

      if (!response.ok) {
        throw new ApiError(`SeriesDonghua rechazo el servidor ${option.name}.`, response.status)
      }

      const payload = (await response.json()) as { success?: boolean; embed_url?: string }
      const embed = payload.embed_url?.trim()

      if (!payload.success || !embed) {
        throw new ApiError(`SeriesDonghua no devolvio el servidor ${option.name}.`, 502)
      }

      return { name: option.name, embed, download: embed }
    }),
  )

  return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
}

function toEmbeddedVideoUrl(platform: string, value: string): string {
  if (platform === 'asura') {
    const playerUrl = new URL('https://geo.dailymotion.com/player.html')
    playerUrl.searchParams.set('video', value)
    return playerUrl.toString()
  }

  return value
}

function parseCoverFromHtml(html: string): string | undefined {
  const metaMatch = html.match(/<meta property="og:image" content="([^"]+)"/i)
  if (metaMatch?.[1]) {
    return toAbsoluteUrl(metaMatch[1])
  }

  const bannerMatch = html.match(/<div class="banner-serie" style="background-image:\s*url\(([^)]+)\)"/i)
  if (bannerMatch?.[1]) {
    return toAbsoluteUrl(bannerMatch[1].replace(/^['"]|['"]$/g, ''))
  }

  return undefined
}

function parseSeriesSlugFromEpisodeHtml(html: string, fallbackSlug: string): string {
  const match = html.match(/<a href="([^"]+)"[^>]*>\s*<i class="fa fa-list/i)

  if (match?.[1]) {
    return extractSlug(toAbsoluteUrl(match[1]))
  }

  return fallbackSlug
}

function parseSeriesTitleFromEpisodeHtml(html: string, fallbackSlug: string): string {
  const bannerTitle = normalizeText(
    html.match(/<div[^>]*font-size:\s*45px[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? '',
  )

  if (bannerTitle) {
    return bannerTitle
  }

  const pageTitle = normalizeText(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '')
    .replace(/\s*[:\-]\s*E\d+(?:\.\d+)?[\s\S]*$/i, '')
    .replace(/\s+Donghua[\s\S]*$/i, '')
    .replace(/\|[\s\S]*$/i, '')
    .trim()

  return pageTitle || fallbackSlug
}

function parseSummaryCards(html: string): AnimeSummary[] {
  const modernMedia = extractCardBlocks(html).flatMap((card) => {
    const anchorTag = card.match(/<a\b[^>]*href=["'][^"']+["'][^>]*>/i)?.[0] ?? ''
    const href = readAttribute(anchorTag, 'href')
    const imageTag = card.match(/<img\b[^>]*>/i)?.[0] ?? ''
    const image = readAttribute(imageTag, 'src')
    const title = normalizeText(card.match(/<h3\b[^>]*class=["'][^"']*card-title[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? '')

    if (!href || /-episodio-\d+(?:\.\d+)?\/?$/i.test(href) || !image || !title) {
      return []
    }

    const url = toAbsoluteUrl(href)
    return [{
      title,
      slug: extractSlug(url),
      type: 'donghua',
      cover: toAbsoluteUrl(image),
      rating: 'SeriesDonghua',
      url,
    } satisfies AnimeSummary]
  })

  if (modernMedia.length > 0) {
    return modernMedia
  }

  const cardPattern =
    /<div class="item col-lg-3 col-md-3 col-xs-6">\s*<a href="([^"]+)" class="angled-img">[\s\S]*?<img src="([^"]+)"[^>]*>[\s\S]*?<div class="badge show [^"]*">([\s\S]*?)<\/div>[\s\S]*?<h5[^>]*>([\s\S]*?)<\/h5>/g

  const media: AnimeSummary[] = []

  for (const match of html.matchAll(cardPattern)) {
    const [, href = '', image = '', rawType = '', rawTitle = ''] = match
    const title = normalizeText(rawTitle)
    const type = normalizeText(rawType) || 'Donghua'

    if (!href || !image || !title) {
      continue
    }

    const url = toAbsoluteUrl(href)

    media.push({
      title,
      slug: extractSlug(url),
      type: type.toLowerCase(),
      cover: toAbsoluteUrl(image),
      rating: 'SeriesDonghua',
      url,
    })
  }

  return media
}

function parseListingPage(html: string, fallbackPage: number, mode: SearchResultPage['mode']): SearchResultPage {
  const media = parseSummaryCards(html)
  const activePage =
    Number(html.match(/<li class="active"><a href="javascript:void\(0\);">(\d+)<\/a><\/li>/i)?.[1] ?? '') ||
    fallbackPage
  const foundPages = Math.max(
    activePage,
    ...Array.from(html.matchAll(/href="\?pag=(\d+)"/g)).map((match) => Number(match[1] ?? '0')),
  )
  const hasNextPage = /fa-angle-right/.test(html)
  const nextPageMatch = html.match(/<li><a href="\?pag=(\d+)"><i class="fa fa-angle-right"/i)
  const previousPageMatch = html.match(/<li><a href="\?pag=(\d+)"><i class="fa fa-angle-left"/i)

  return {
    currentPage: activePage,
    hasNextPage,
    previousPage: previousPageMatch ? String(Number(previousPageMatch[1])) : null,
    nextPage: nextPageMatch ? String(Number(nextPageMatch[1])) : null,
    foundPages,
    media,
    mode,
  }
}

function cleanRecentEpisodeTitle(value: string): string {
  return normalizeText(value)
    .replace(/^donghua\s+/i, '')
    .replace(/\s+episodio\s+\d+(?:\.\d+)?$/i, '')
    .trim()
}

function extractAnimeSlugFromEpisodeSlug(value: string): string {
  return value
    .replace(/-episodio-\d+(?:\.\d+)?$/i, '')
    .replace(/^\/+|\/+$/g, '')
}

function parseEpisodeLinksFromDetailHtml(html: string): AnimeEpisodeLink[] {
  const episodeMap = new Map<number, AnimeEpisodeLink>()

  for (const card of extractCardBlocks(html, 'episode-card-item')) {
    const articleTag = card.match(/<article\b[^>]*>/i)?.[0] ?? ''
    const anchorTag = card.match(/<a\b[^>]*href=["'][^"']+["'][^>]*>/i)?.[0] ?? ''
    const href = readAttribute(anchorTag, 'href')
    const url = href ? toAbsoluteUrl(href) : ''
    const episodeSlug = extractSlug(url)
    const number =
      extractFirstNumber(readAttribute(articleTag, 'data-ep')) ??
      extractEpisodeNumber(episodeSlug) ??
      extractEpisodeNumber(card)

    if (!number || !episodeSlug || episodeMap.has(number)) {
      continue
    }

    episodeMap.set(number, {
      number,
      slug: episodeSlug,
      routeParam: episodeSlug,
      url,
    })
  }

  if (episodeMap.size > 0) {
    return sortEpisodes([...episodeMap.values()])
  }

  const episodesBlock = html.match(/<ul class="donghua-list">([\s\S]*?)<\/ul>/i)?.[1] ?? ''

  for (const match of episodesBlock.matchAll(/<a href="([^"]+)"[^>]*>[\s\S]*?<blockquote[^>]*>([\s\S]*?)<\/blockquote>/g)) {
    const [, href = '', rawLabel = ''] = match
    const url = toAbsoluteUrl(href)
    const episodeSlug = extractSlug(url)
    const number = extractEpisodeNumber(episodeSlug) ?? extractEpisodeNumber(rawLabel) ?? extractFirstNumber(rawLabel)

    if (!number || !episodeSlug || episodeMap.has(number)) {
      continue
    }

    episodeMap.set(number, {
      number,
      slug: episodeSlug,
      routeParam: episodeSlug,
      url,
    })
  }

  return sortEpisodes([...episodeMap.values()])
}

function parseRecentEpisodeCards(html: string): EpisodeSummary[] {
  const episodes: EpisodeSummary[] = []
  const seen = new Set<string>()

  for (const card of extractCardBlocks(html)) {
    const anchorTag = card.match(/<a\b[^>]*href=["'][^"']+["'][^>]*>/i)?.[0] ?? ''
    const href = readAttribute(anchorTag, 'href')
    const episodeSlug = extractSlug(href)
    const number = extractEpisodeNumber(episodeSlug) ?? extractEpisodeNumber(card)
    const animeSlug = extractAnimeSlugFromEpisodeSlug(episodeSlug)
    const rawTitle = card.match(/<h3\b[^>]*class=["'][^"']*card-title[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? ''
    const title = cleanRecentEpisodeTitle(rawTitle)
    const imageTag = card.match(/<img\b[^>]*>/i)?.[0] ?? ''
    const image = readAttribute(imageTag, 'src')

    if (!episodeSlug || !animeSlug || !title || !number || seen.has(episodeSlug)) {
      continue
    }

    episodes.push({
      title,
      animeSlug,
      episodeSlug,
      number,
      routeParam: episodeSlug,
      cover: image ? toAbsoluteUrl(image) : undefined,
      url: toAbsoluteUrl(href),
    })
    seen.add(episodeSlug)
  }

  if (episodes.length > 0) {
    return episodes
  }

  const primaryPattern =
    /<a href="([^"]*?-episodio-(\d+(?:\.\d+)?)[^"]*)"[^>]*class="angled-img"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]*>[\s\S]*?<h5[^>]*>([\s\S]*?)<\/h5>/gi

  for (const match of html.matchAll(primaryPattern)) {
    const [, href = '', rawNumber = '', image = '', rawTitle = ''] = match
    const url = toAbsoluteUrl(href)
    const episodeSlug = extractSlug(url)
    const number = extractEpisodeNumber(rawTitle) ?? Number(rawNumber)
    const animeSlug = extractAnimeSlugFromEpisodeSlug(episodeSlug)
    const title = cleanRecentEpisodeTitle(rawTitle)

    if (!episodeSlug || !animeSlug || !title || !Number.isFinite(number) || seen.has(episodeSlug)) {
      continue
    }

    episodes.push({
      title,
      animeSlug,
      episodeSlug,
      number,
      routeParam: episodeSlug,
      cover: image ? toAbsoluteUrl(image) : undefined,
      url,
    })
    seen.add(episodeSlug)
  }

  if (episodes.length > 0) {
    return episodes
  }

  const fallbackPattern = /<a href="([^"]*?-episodio-(\d+(?:\.\d+)?)[^"]*)"[^>]*>\s*([^<]+?)\s*<\/a>/gi

  for (const match of html.matchAll(fallbackPattern)) {
    const [, href = '', rawNumber = '', rawTitle = ''] = match
    const url = toAbsoluteUrl(href)
    const episodeSlug = extractSlug(url)
    const number = extractEpisodeNumber(rawTitle) ?? Number(rawNumber)
    const animeSlug = extractAnimeSlugFromEpisodeSlug(episodeSlug)
    const title = cleanRecentEpisodeTitle(rawTitle)

    if (!episodeSlug || !animeSlug || !title || !Number.isFinite(number) || seen.has(episodeSlug)) {
      continue
    }

    episodes.push({
      title,
      animeSlug,
      episodeSlug,
      number,
      routeParam: episodeSlug,
      url,
    })
    seen.add(episodeSlug)
  }

  return episodes
}

export async function getSeriesDonghuaRecentEpisodes(signal?: AbortSignal): Promise<EpisodeSummary[]> {
  const response = await requestText(SERIES_DONGHUA_RECENT_URL, signal)
  return parseRecentEpisodeCards(response.bodyText).slice(0, 18)
}
export async function getSeriesDonghuaPreview(signal?: AbortSignal): Promise<AnimeSummary[]> {
  const response = await requestText(SERIES_DONGHUA_ON_AIR_URL, signal)
  return parseSummaryCards(response.bodyText).slice(0, 12)
}

export async function getSeriesDonghuaCatalog(
  page = 1,
  signal?: AbortSignal,
): Promise<SearchResultPage> {
  const response = await requestText(withPageParam(SERIES_DONGHUA_CATALOG_URL, page), signal)
  return parseListingPage(response.bodyText, page, 'catalog')
}

export async function searchSeriesDonghua(
  query: string,
  page = 1,
  signal?: AbortSignal,
): Promise<SearchResultPage> {
  const normalizedQuery = query.trim()

  if (!normalizedQuery) {
    return {
      currentPage: 1,
      hasNextPage: false,
      previousPage: null,
      nextPage: null,
      foundPages: 0,
      media: [],
      mode: 'text',
    }
  }

  const response = await requestText(
    withPageParam(`${SERIES_DONGHUA_BASE_URL}/busquedas/${encodeURIComponent(normalizedQuery)}`, page),
    signal,
  )

  return parseListingPage(response.bodyText, page, 'text')
}

export async function getSeriesDonghuaDetail(
  slug: string,
  signal?: AbortSignal,
): Promise<AnimeDetail> {
  const response = await requestText(buildSeriesUrl(slug), signal)
  const html = response.bodyText

  const title =
    normalizeText(html.match(/<h1\b[^>]*class=["'][^"']*hero-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '') ||
    normalizeText(html.match(/<div class="sf fc-dark ls-title-serie">([\s\S]*?)<\/div>/i)?.[1] ?? '') ||
    normalizeText(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '')

  if (!title) {
    throw new ApiError('No pude leer el detalle del donghua.', 502)
  }

  const status = normalizeText(
    html.match(/class=["'][^"']*badge-status-([^"']+)["'][^>]*>([\s\S]*?)<\/span>/i)?.[2] ??
      html.match(/Estado:\s*<\/div>[\s\S]*?<span class="badge bg-default">([\s\S]*?)<\/span>/i)?.[1] ??
      '',
  )

  const synopsis = normalizeText(
    html.match(/<h2[^>]*>[\s\S]*?Sinopsis[\s\S]*?<\/h2>[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i)?.[1] ??
      html.match(/Sinopsis<\/div>[\s\S]*?<div class="text-justify fc-dark">([\s\S]*?)<\/div>/i)?.[1] ??
      '',
  )

  const genres = Array.from(
    html.matchAll(/<a href="[^"]+" class="generos[^"]*">[\s\S]*?<span class="label[^"]*">([\s\S]*?)<\/span>/g),
  )
    .map((match) => normalizeText(match[1] ?? ''))
    .filter(Boolean)

  const episodes = parseEpisodeLinksFromDetailHtml(html)

  return {
    title,
    slug,
    type: 'donghua',
    cover: parseCoverFromHtml(html),
    synopsis,
    rating: 'SeriesDonghua',
    alternativeTitles: [],
    status: status || 'Sin estado',
    genres,
    nextAiringEpisode: null,
    episodes,
    related: [],
    url: buildSeriesUrl(slug),
  }
}

async function resolveSeriesDonghuaEpisodeSlug(
  slug: string,
  rawEpisodeIdentifier: string,
  episodeNumber: number,
  signal?: AbortSignal,
): Promise<string> {
  if (/-episodio-\d+(?:\.\d+)?$/i.test(rawEpisodeIdentifier)) {
    return rawEpisodeIdentifier.replace(/^\/+|\/+$/g, '')
  }

  try {
    const response = await requestText(buildSeriesUrl(slug), signal)
    const matchingEpisode = parseEpisodeLinksFromDetailHtml(response.bodyText).find(
      (episode) => episode.number === episodeNumber && episode.routeParam?.trim(),
    )

    if (matchingEpisode?.routeParam?.trim()) {
      return matchingEpisode.routeParam.trim()
    }
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error
    }
  }

  return `${slug.replace(/^\/+|\/+$/g, '')}-episodio-${episodeNumber}`
}

export async function getSeriesDonghuaEpisode(
  slug: string,
  episodeIdentifier: string | number,
  signal?: AbortSignal,
): Promise<EpisodeDetail> {
  const rawEpisodeIdentifier = String(episodeIdentifier).trim()
  const episodeNumber =
    extractEpisodeNumber(rawEpisodeIdentifier) ?? extractFirstNumber(rawEpisodeIdentifier)

  if (!episodeNumber) {
    throw new ApiError('No pude identificar el episodio solicitado.', 400)
  }

  const normalizedEpisodeSlug = await resolveSeriesDonghuaEpisodeSlug(
    slug,
    rawEpisodeIdentifier,
    episodeNumber,
    signal,
  )
  const response = await requestText(buildEpisodeUrlFromIdentifier(normalizedEpisodeSlug), signal)
  const html = response.bodyText
  const platformLabels = parsePlatformLabels(html)
  const unpackedScript = unpackPlayerScript(html)
  let servers: EpisodeDetail['servers'] = []

  if (unpackedScript) {
    const videoMap = parseVideoMap(unpackedScript)
    servers = [...platformLabels.entries()]
      .map(([platform, name]) => {
        const source = videoMap[platform]
        if (!source) {
          return null
        }

        const embedTarget = toEmbeddedVideoUrl(platform, source)

        return {
          name,
          embed: embedTarget,
          download: embedTarget,
        }
      })
      .filter((server): server is NonNullable<typeof server> => Boolean(server))
  }

  if (servers.length === 0) {
    servers = await resolveModernPlayerServers(html, response, response.url, signal)
  }

  if (servers.length === 0) {
    throw new ApiError('SeriesDonghua no devolvio servidores para este episodio.', 502)
  }

  const fallbackSeriesSlug = extractAnimeSlugFromEpisodeSlug(normalizedEpisodeSlug) || slug
  const animeSlug = parseSeriesSlugFromEpisodeHtml(html, fallbackSeriesSlug)
  const seriesTitle = parseSeriesTitleFromEpisodeHtml(html, fallbackSeriesSlug)

  return {
    animeSlug,
    title: `${seriesTitle} - ${episodeNumber}`,
    number: episodeNumber,
    routeParam: normalizedEpisodeSlug,
    servers,
  }
}









