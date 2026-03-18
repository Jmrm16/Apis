import type { FastifyPluginAsync } from 'fastify'
import { getAvailableProviders, getProvider } from '../providers/index.js'
import { getTmoChapterPages } from '../services/tmo.js'
import type {
  AnimeStatusCode,
  SearchOrder,
  SearchParams,
} from '../types/anime.js'

interface SearchQuerystring {
  query?: string
  page?: string
  order?: SearchOrder
}

interface SearchFilterBody {
  genres?: string[]
  statuses?: AnimeStatusCode[]
  types?: string[]
}

interface TmoChapterPagesQuerystring {
  chapterUrl?: string
  referer?: string
  urlPage?: string
  urlRefer?: string
}

function toPositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function buildSearchParams(
  query: SearchQuerystring,
  body?: SearchFilterBody,
): SearchParams {
  return {
    query: query.query?.trim() ?? '',
    page: toPositiveNumber(query.page, 1),
    order: query.order ?? 'default',
    genres: body?.genres ?? [],
    statuses: body?.statuses ?? [],
    types: body?.types ?? [],
  }
}

export const apiRoutes: FastifyPluginAsync = async (app) => {
  const provider = getProvider()

  app.get('/health', async () => ({
    success: true,
    data: {
      ok: true,
      provider: provider.key,
    },
  }))

  app.get('/providers', async () => ({
    success: true,
    data: {
      current: provider.key,
      available: getAvailableProviders(),
    },
  }))

  app.get('/home', async (_, reply) => {
    const [latestEpisodes, onAir] = await Promise.all([
      provider.getLatestEpisodes(),
      provider.getOnAir(),
    ])

    return reply.send({
      success: true,
      data: {
        latestEpisodes,
        onAir,
      },
    })
  })

  app.get('/list/latest-episodes', async (_, reply) => {
    const latestEpisodes = await provider.getLatestEpisodes()
    return reply.send({ success: true, data: latestEpisodes })
  })

  app.get('/list/animes-on-air', async (_, reply) => {
    const onAir = await provider.getOnAir()
    return reply.send({ success: true, data: onAir })
  })

  app.get<{ Querystring: SearchQuerystring }>('/search', async (request, reply) => {
    const data = await provider.search(buildSearchParams(request.query), request.signal)
    return reply.send({ success: true, data })
  })

  app.post<{ Querystring: SearchQuerystring; Body: SearchFilterBody }>(
    '/search/by-filter',
    async (request, reply) => {
      const data = await provider.search(
        buildSearchParams(request.query, request.body),
        request.signal,
      )

      return reply.send({ success: true, data })
    },
  )

  app.get<{ Params: { slug: string } }>('/anime/:slug', async (request, reply) => {
    const data = await provider.getAnimeBySlug(request.params.slug, request.signal)
    return reply.send({ success: true, data })
  })

  app.get<{ Params: { slug: string; number: string } }>(
    '/anime/:slug/episode/:number',
    async (request, reply) => {
      const data = await provider.getEpisodeByNumber(
        request.params.slug,
        toPositiveNumber(request.params.number, 1),
        request.signal,
      )

      return reply.send({ success: true, data })
    },
  )

  app.get<{ Querystring: TmoChapterPagesQuerystring }>(
    '/manga/chapter-pages',
    async (request, reply) => {
      const chapterUrl =
        request.query.chapterUrl?.trim() || request.query.urlPage?.trim() || ''
      const referer = request.query.referer?.trim() || request.query.urlRefer?.trim()

      const data = await getTmoChapterPages(chapterUrl, referer, request.signal)

      return reply.send({ success: true, data })
    },
  )
}
