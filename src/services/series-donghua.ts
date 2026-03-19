import { requestText } from '../lib/http.js'
import type { AnimeSummary } from '../types/anime.js'

const SERIES_DONGHUA_BASE_URL = 'https://seriesdonghua.com'
const SERIES_DONGHUA_ON_AIR_URL = `${SERIES_DONGHUA_BASE_URL}/donghuas-en-emision`

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

function extractSlug(value: string): string {
  try {
    const parsed = new URL(value, SERIES_DONGHUA_BASE_URL)
    return parsed.pathname.replace(/^\/+|\/+$/g, '')
  } catch {
    return value.replace(/^\/+|\/+$/g, '')
  }
}

export async function getSeriesDonghuaPreview(signal?: AbortSignal): Promise<AnimeSummary[]> {
  const response = await requestText(SERIES_DONGHUA_ON_AIR_URL, signal)
  const html = response.bodyText
  const itemPattern =
    /<div class="item col-lg-3 col-md-3 col-xs-6">\s*<a href="([^"]+)" class="angled-img">[\s\S]*?<img src="([^"]+)"[^>]*>[\s\S]*?<h5[^>]*>([\s\S]*?)<\/h5>/g

  const media: AnimeSummary[] = []

  for (const match of html.matchAll(itemPattern)) {
    const [, href = '', image = '', rawTitle = ''] = match
    const title = normalizeText(rawTitle)

    if (!href || !image || !title) {
      continue
    }

    const url = new URL(href, SERIES_DONGHUA_BASE_URL).toString()
    const slug = extractSlug(url)

    media.push({
      title,
      slug,
      type: 'donghua',
      cover: image,
      rating: 'SeriesDonghua',
      url,
    })

    if (media.length >= 12) {
      break
    }
  }

  return media
}
