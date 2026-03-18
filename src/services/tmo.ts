import { ApiError, requestText } from '../lib/http.js'
import type { MangaChapterPages } from '../types/manga.js'

const DEFAULT_REFERER = 'https://zonatmo.com/'
const DEFAULT_HOME = 'https://lectortmo.com/'

const BROWSER_HEADERS = {
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
  'accept-language': 'es-419,es;q=0.9,en;q=0.8',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'same-origin',
  'upgrade-insecure-requests': '1',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
}

function getReaderUrl(url: string): string {
  if (url.includes('/paginated/1')) {
    return url.replace('/paginated/1', '/cascade')
  }

  if (url.includes('/paginated')) {
    return url.replace('/paginated', '/cascade')
  }

  if (url.includes('/cascade/1')) {
    return url.replace('/cascade/1', '/cascade')
  }

  return url
}

function swapTmoHost(url: string): string {
  if (url.includes('lectortmo.com')) {
    return url.replace('lectortmo.com', 'zonatmo.com')
  }

  if (url.includes('zonatmo.com')) {
    return url.replace('zonatmo.com', 'lectortmo.com')
  }

  return url
}

function resolveReferer(chapterUrl: string, referer?: string): string {
  const value = referer?.trim()
  if (value) {
    return value
  }

  try {
    const parsedUrl = new URL(chapterUrl)
    if (
      parsedUrl.hostname.includes('lectortmo.com') ||
      parsedUrl.hostname.includes('zonatmo.com')
    ) {
      return DEFAULT_REFERER
    }

    return `${parsedUrl.protocol}//${parsedUrl.host}/`
  } catch {
    return DEFAULT_REFERER
  }
}

function getHomeUrl(chapterUrl: string): string {
  try {
    const parsedUrl = new URL(chapterUrl)
    return `${parsedUrl.protocol}//${parsedUrl.host}/`
  } catch {
    return DEFAULT_HOME
  }
}

function getCookieHeader(response: Response): string {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[]
  }

  const setCookies = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : []

  return setCookies
    .map((cookie) => cookie.split(';', 1)[0]?.trim())
    .filter(Boolean)
    .join('; ')
}

function extractImages(html: string): string[] {
  const matches = html.matchAll(
    /<div[^>]*class=["'][^"']*img-container[^"']*["'][^>]*>[\s\S]*?<img[^>]*data-src=["']([^"']+)["']/gi,
  )

  const pages = Array.from(matches, (match) => match[1]?.trim()).filter(
    (value): value is string => Boolean(value),
  )

  return Array.from(new Set(pages))
}

function extractReaderUrlFromHtml(html: string, fallbackUrl: string): string {
  const cascadeMatch = html.match(/https?:\/\/[^"'\\s]+\/cascade(?:\/1)?/i)
  if (cascadeMatch?.[0]) {
    return getReaderUrl(cascadeMatch[0])
  }

  const paginatedMatch = html.match(/https?:\/\/[^"'\\s]+\/paginated(?:\/1)?/i)
  if (paginatedMatch?.[0]) {
    return getReaderUrl(paginatedMatch[0])
  }

  return getReaderUrl(fallbackUrl)
}

async function fetchWithSession(url: string, referer: string, signal?: AbortSignal) {
  const homeUrl = getHomeUrl(url)

  const homeResponse = await requestText(homeUrl, signal, {
    headers: BROWSER_HEADERS,
    referrer: referer,
  })

  const cookieHeader = getCookieHeader(homeResponse)

  const pageResponse = await requestText(url, signal, {
    headers: {
      ...BROWSER_HEADERS,
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
    referrer: referer,
  })

  return {
    pageResponse,
    cookieHeader,
  }
}

async function tryFetchChapterPages(
  chapterUrl: string,
  referer: string,
  signal?: AbortSignal,
): Promise<MangaChapterPages> {
  const { pageResponse, cookieHeader } = await fetchWithSession(chapterUrl, referer, signal)

  const resolvedUrl = pageResponse.url || chapterUrl
  const readerUrl = extractReaderUrlFromHtml(pageResponse.bodyText, resolvedUrl)

  const readerResponse = await requestText(readerUrl, signal, {
    headers: {
      ...BROWSER_HEADERS,
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
    referrer: resolvedUrl,
  })

  const pages = extractImages(readerResponse.bodyText)

  if (pages.length === 0) {
    throw new ApiError('No se encontraron paginas para este capitulo.', 404)
  }

  return {
    source: 'tmo',
    chapterUrl,
    resolvedUrl,
    readerUrl: readerResponse.url || readerUrl,
    referer,
    totalPages: pages.length,
    pages,
  }
}

export async function getTmoChapterPages(
  chapterUrl: string,
  referer?: string,
  signal?: AbortSignal,
): Promise<MangaChapterPages> {
  const cleanChapterUrl = chapterUrl.trim()

  if (!cleanChapterUrl) {
    throw new ApiError('El parametro chapterUrl es requerido.', 400)
  }

  const resolvedReferer = resolveReferer(cleanChapterUrl, referer)
  const alternateChapterUrl = swapTmoHost(cleanChapterUrl)
  const alternateReferer = resolveReferer(alternateChapterUrl, referer)

  const attempts: Array<{ chapterUrl: string; referer: string }> = [
    { chapterUrl: cleanChapterUrl, referer: resolvedReferer },
  ]

  if (alternateChapterUrl !== cleanChapterUrl) {
    attempts.push({ chapterUrl: alternateChapterUrl, referer: alternateReferer })
  }

  let lastError: unknown

  for (const attempt of attempts) {
    try {
      return await tryFetchChapterPages(attempt.chapterUrl, attempt.referer, signal)
    } catch (error) {
      lastError = error
    }
  }

  if (lastError instanceof ApiError && lastError.statusCode === 403) {
    throw new ApiError(
      'TMO devolvio Forbidden. Es probable que este bloqueando la IP del servidor o requiera mas protecciones anti-bot.',
      403,
    )
  }

  if (lastError instanceof ApiError) {
    throw lastError
  }

  throw new ApiError('No fue posible obtener las paginas del capitulo.', 502)
}
