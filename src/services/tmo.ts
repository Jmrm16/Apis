import { ApiError, requestText } from '../lib/http.js'
import type { MangaChapterPages } from '../types/manga.js'

const DEFAULT_REFERER = 'https://zonatmo.com/'

const BROWSER_HEADERS = {
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
  'accept-language': 'es-419,es;q=0.9,en;q=0.8',
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

  const initialResponse = await requestText(cleanChapterUrl, signal, {
    headers: {
      ...BROWSER_HEADERS,
      referer: resolvedReferer,
    },
  })

  const resolvedUrl = initialResponse.url || cleanChapterUrl
  const readerUrl = extractReaderUrlFromHtml(initialResponse.bodyText, resolvedUrl)

  const readerResponse = await requestText(readerUrl, signal, {
    headers: {
      ...BROWSER_HEADERS,
      referer: resolvedUrl,
    },
  })

  const pages = extractImages(readerResponse.bodyText)

  if (pages.length === 0) {
    throw new ApiError('No se encontraron paginas para este capitulo.', 404)
  }

  return {
    source: 'tmo',
    chapterUrl: cleanChapterUrl,
    resolvedUrl,
    readerUrl: readerResponse.url || readerUrl,
    referer: resolvedReferer,
    totalPages: pages.length,
    pages,
  }
}
