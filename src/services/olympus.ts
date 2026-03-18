import { ApiError, requestText } from '../lib/http.js'
import type { OlympusChapterData } from '../types/manga.js'

const OLYMPUS_BASE_URL = 'https://olympusbiblioteca.com'
const OLYMPUS_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  Referer: `${OLYMPUS_BASE_URL}/`,
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
}

interface OlympusChapterOptions {
  payloadUrl?: string
  chapterUrl?: string
  chapterId?: string
  slug?: string
  type?: string
}

type NuxtPayload = unknown[]

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

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
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

function ensureUrlPath(value: string): string {
  return value.startsWith('/') ? value : `/${value}`
}

function getPayloadUrl(options: OlympusChapterOptions): string {
  const payloadUrl = options.payloadUrl?.trim()
  if (payloadUrl) {
    return payloadUrl
  }

  const chapterUrl = options.chapterUrl?.trim()
  if (chapterUrl) {
    const url = new URL(chapterUrl)
    url.pathname = `${url.pathname.replace(/\/$/, '')}/_payload.json`
    return url.toString()
  }

  const chapterId = options.chapterId?.trim()
  const slug = options.slug?.trim()
  const type = options.type?.trim() || 'comic'

  if (!chapterId || !slug) {
    throw new ApiError(
      'Debes enviar payloadUrl, chapterUrl o chapterId + slug para consultar Olympus.',
      400,
    )
  }

  return `${OLYMPUS_BASE_URL}/capitulo/${chapterId}/${type}-${slug}/_payload.json`
}

function getChapterUrl(payloadUrl: string): string {
  const url = new URL(payloadUrl)
  url.pathname = url.pathname.replace(/\/_payload\.json$/, '')
  url.search = ''
  return url.toString()
}

function getRouteData(payload: NuxtPayload): {
  routePath: string
  routeData: Record<string, unknown>
} {
  const root = resolveNuxtValue(payload, payload[0])

  if (!root || typeof root !== 'object' || !('data' in root)) {
    throw new ApiError('Olympus respondio con un payload invalido.', 502)
  }

  const routeMap = root.data
  if (!routeMap || typeof routeMap !== 'object' || Array.isArray(routeMap)) {
    throw new ApiError('Olympus no devolvio la ruta esperada.', 502)
  }

  const [routePath, routeData] = Object.entries(routeMap)[0] ?? []
  if (!routePath || !routeData || typeof routeData !== 'object' || Array.isArray(routeData)) {
    throw new ApiError('No se pudieron resolver los datos del capitulo en Olympus.', 502)
  }

  return {
    routePath,
    routeData: routeData as Record<string, unknown>,
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

function buildSiteUrl(path: string): string {
  return new URL(ensureUrlPath(path), OLYMPUS_BASE_URL).toString()
}

export async function getOlympusChapterData(
  options: OlympusChapterOptions,
  signal?: AbortSignal,
): Promise<OlympusChapterData> {
  const payloadUrl = getPayloadUrl(options)
  const response = await requestText(payloadUrl, signal, {
    headers: OLYMPUS_HEADERS,
  })

  let payload: NuxtPayload

  try {
    payload = JSON.parse(response.bodyText) as NuxtPayload
  } catch {
    throw new ApiError('Olympus devolvio un payload que no se pudo interpretar.', 502)
  }

  if (!Array.isArray(payload) || payload.length === 0) {
    throw new ApiError('Olympus devolvio un payload vacio o invalido.', 502)
  }

  const { routePath, routeData } = getRouteData(payload)
  const chapter = (routeData.chapter ?? null) as Record<string, unknown> | null
  const comic = (routeData.comic ?? null) as Record<string, unknown> | null
  const prevChapter = (routeData.prev_chapter ?? null) as Record<string, unknown> | null
  const nextChapter = (routeData.next_chapter ?? null) as Record<string, unknown> | null

  if (!chapter) {
    throw new ApiError('Olympus no devolvio la informacion del capitulo.', 502)
  }

  const recommendedSeries = Array.isArray(chapter.recommended_series)
    ? chapter.recommended_series
    : []

  const chapterType = readText(chapter.type)
  const seriesSlug = readText(comic?.slug)
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
    payloadUrl,
    routePath,
    chapterUrl: getChapterUrl(payloadUrl),
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
            url: buildSiteUrl(`/series/${seriesRouteSlug}`),
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

        const recommendedSlug = readText(item.slug)
        const recommendedType = readText(item.type)
        const recommendedName = readText(item.name)

        if (!recommendedSlug || !recommendedName) {
          return null
        }

        return {
          id: (item.id as number | string | undefined) ?? '',
          name: recommendedName,
          slug: recommendedSlug,
          status: readName(item.status),
          cover: readText(item.cover),
          type: recommendedType,
          url: buildSiteUrl(
            `/series/${buildSeriesRouteSlug(recommendedType, recommendedSlug) ?? recommendedSlug}`,
          ),
        }
      })
      .filter((item): item is OlympusChapterData['recommendedSeries'][number] => Boolean(item)),
  }
}

