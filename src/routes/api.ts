import type { FastifyPluginAsync } from 'fastify'
import { getAvailableProviders, getProvider } from '../providers/index.js'
import { getMangaDetail, getMangaHome, getMangaReadData, searchManga } from '../services/manga.js'
import { getMihonCatalog, getMihonImportedCatalogs, importMihonCatalog, removeMihonImportedCatalog } from '../services/mihon-repo.js'
import { createMangaChapterPdf } from '../services/manga-pdf.js'
import { getDonghuaLifeCatalog, getDonghuaLifeDetail, getDonghuaLifeEpisode, getDonghuaLifePreview, getDonghuaLifeRecentEpisodes, searchDonghuaLife } from '../services/donghua-life.js'
import { getOlympusChapterData } from '../services/olympus.js'
import { getNamiComiMangaDetail, getNamiComiMangaHome, getNamiComiMangaReadData, searchNamiComiManga } from '../services/namicomi.js'
import {
  getSeriesDonghuaCatalog,
  getSeriesDonghuaDetail,
  getSeriesDonghuaEpisode,
  getSeriesDonghuaPreview, getSeriesDonghuaRecentEpisodes, searchSeriesDonghua,
} from '../services/series-donghua.js'
import { getTmoChapterPagesWithBrowser } from '../services/tmo-browser.js'
import { getTmoChapterPages } from '../services/tmo.js'
import type { AnimeStatusCode, SearchOrder, SearchParams } from '../types/anime.js'

interface SearchQuerystring {
  query?: string
  page?: string
  order?: SearchOrder
}

interface MangaSearchQuerystring {
  query?: string
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

interface OlympusChapterQuerystring {
  payloadUrl?: string
  chapterUrl?: string
  chapterId?: string
  slug?: string
  type?: string
}

interface MangaChapterPdfBody {
  title?: string
  pages?: string[]
  referer?: string
}

interface MihonCatalogQuerystring {
  query?: string
  lang?: string
  nsfw?: string
  page?: string
  limit?: string
  refresh?: string
}

interface MihonImportBody {
  name?: string
  repoUrl?: string
  jsonText?: string
}

function toPositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function buildSearchParams(query: SearchQuerystring, body?: SearchFilterBody): SearchParams {
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

  app.get<{ Querystring: SearchQuerystring }>('/donghua/catalog', async (request, reply) => {
    const data = await getSeriesDonghuaCatalog(toPositiveNumber(request.query.page, 1), request.signal)
    return reply.send({ success: true, data })
  })

  app.get<{ Querystring: SearchQuerystring }>('/donghua/search', async (request, reply) => {
    const data = await searchSeriesDonghua(
      request.query.query?.trim() ?? '',
      toPositiveNumber(request.query.page, 1),
      request.signal,
    )

    return reply.send({ success: true, data })
  })

  app.get('/donghua/recent', async (request, reply) => {
    const data = await getSeriesDonghuaRecentEpisodes(request.signal)
    return reply.send({ success: true, data })
  })


  app.get<{ Params: { slug: string } }>('/donghua/:slug', async (request, reply) => {
    const data = await getSeriesDonghuaDetail(request.params.slug, request.signal)
    return reply.send({ success: true, data })
  })

  app.get<{ Params: { slug: string; number: string } }>(
    '/donghua/:slug/episode/:number',
    async (request, reply) => {
      const data = await getSeriesDonghuaEpisode(
        request.params.slug,
        request.params.number,
        request.signal,
      )

      return reply.send({ success: true, data })
    },
  )

  app.get<{ Querystring: SearchQuerystring }>('/donghua-life/catalog', async (request, reply) => {
    const data = await getDonghuaLifeCatalog(toPositiveNumber(request.query.page, 1), request.signal)
    return reply.send({ success: true, data })
  })

  app.get<{ Querystring: SearchQuerystring }>('/donghua-life/search', async (request, reply) => {
    const data = await searchDonghuaLife(
      request.query.query?.trim() ?? '',
      toPositiveNumber(request.query.page, 1),
      request.signal,
    )

    return reply.send({ success: true, data })
  })

  app.get('/donghua-life/recent', async (request, reply) => {
    const data = await getDonghuaLifeRecentEpisodes(request.signal)
    return reply.send({ success: true, data })
  })


  app.get<{ Params: { slug: string } }>('/donghua-life/:slug', async (request, reply) => {
    const data = await getDonghuaLifeDetail(request.params.slug, request.signal)
    return reply.send({ success: true, data })
  })

  app.get<{ Params: { slug: string; episodeId: string } }>(
    '/donghua-life/:slug/episode/:episodeId',
    async (request, reply) => {
      const data = await getDonghuaLifeEpisode(
        request.params.slug,
        request.params.episodeId,
        request.signal,
      )

      return reply.send({ success: true, data })
    },
  )
  app.get<{ Querystring: SearchQuerystring }>('/search', async (request, reply) => {
    const data = await provider.search(buildSearchParams(request.query), request.signal)
    return reply.send({ success: true, data })
  })

  app.post<{ Querystring: SearchQuerystring; Body: SearchFilterBody }>(
    '/search/by-filter',
    async (request, reply) => {
      try {
        const data = await provider.search(
          buildSearchParams(request.query, request.body),
          request.signal,
        )

        return reply.send({ success: true, data })
      } catch (error) {
        request.log.error(
          {
            err: error,
            provider: provider.key,
            query: request.query,
            body: request.body,
          },
          'Anime filtered search failed',
        )

        const message = error instanceof Error ? error.message : 'Anime filtered search failed.'
        return reply.status(502).send({
          success: false,
          error: message,
        })
      }
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

  app.get<{ Querystring: MihonCatalogQuerystring }>('/mihon/sources', async (request, reply) => {
    const normalizedNsfw =
      request.query.nsfw === 'all' || request.query.nsfw === 'nsfw'
        ? request.query.nsfw
        : request.query.nsfw === '1' || request.query.nsfw === 'true'
          ? 'all'
          : 'safe'

    const data = await getMihonCatalog({
      query: request.query.query,
      lang: request.query.lang,
      nsfw: normalizedNsfw,
      page: toPositiveNumber(request.query.page, 1),
      limit: toPositiveNumber(request.query.limit, 48),
      refresh: request.query.refresh === '1' || request.query.refresh === 'true',
    })

    return reply.send({ success: true, data })
  })
  app.get('/mihon/catalogs', async (_, reply) => {
    const items = await getMihonImportedCatalogs()
    return reply.send({ success: true, data: { items } })
  })

  app.post<{ Body: MihonImportBody }>('/mihon/catalogs', async (request, reply) => {
    const data = await importMihonCatalog({
      name: request.body?.name,
      repoUrl: request.body?.repoUrl,
      jsonText: request.body?.jsonText,
    })

    return reply.send({ success: true, data })
  })

  app.delete<{ Params: { catalogId: string } }>('/mihon/catalogs/:catalogId', async (request, reply) => {
    await removeMihonImportedCatalog(request.params.catalogId)
    return reply.send({ success: true, data: { ok: true } })
  })

  app.get('/manga/namicomi/home', async (request, reply) => {
    const data = await getNamiComiMangaHome(request.signal)
    return reply.send({ success: true, data })
  })

  app.get<{ Querystring: MangaSearchQuerystring }>('/manga/namicomi/search', async (request, reply) => {
    const data = await searchNamiComiManga(request.query.query ?? '', request.signal)
    return reply.send({ success: true, data })
  })

  app.get<{ Params: { id: string; slug: string; chapterId: string } }>(
    '/manga/namicomi/:id/:slug/chapter/:chapterId',
    async (request, reply) => {
      const data = await getNamiComiMangaReadData(
        request.params.id,
        request.params.slug,
        request.params.chapterId,
        request.signal,
      )

      return reply.send({ success: true, data })
    },
  )

  app.get<{ Params: { id: string; slug: string } }>('/manga/namicomi/:id/:slug', async (request, reply) => {
    const data = await getNamiComiMangaDetail(
      request.params.id,
      request.params.slug,
      request.signal,
    )

    return reply.send({ success: true, data })
  })

  app.get('/manga/home', async (request, reply) => {
    const data = await getMangaHome(request.signal)
    return reply.send({ success: true, data })
  })

  app.get<{ Querystring: MangaSearchQuerystring }>('/manga/search', async (request, reply) => {
    const data = await searchManga(request.query.query ?? '', request.signal)
    return reply.send({ success: true, data })
  })

  app.get<{ Querystring: TmoChapterPagesQuerystring }>(
    '/manga/chapter-pages',
    async (request, reply) => {
      const chapterUrl = request.query.chapterUrl?.trim() || request.query.urlPage?.trim() || ''
      const referer = request.query.referer?.trim() || request.query.urlRefer?.trim()

      const data = await getTmoChapterPages(chapterUrl, referer, request.signal)

      return reply.send({ success: true, data })
    },
  )

  app.get<{ Querystring: TmoChapterPagesQuerystring }>(
    '/manga/chapter-pages-browser',
    async (request, reply) => {
      const chapterUrl = request.query.chapterUrl?.trim() || request.query.urlPage?.trim() || ''
      const referer = request.query.referer?.trim() || request.query.urlRefer?.trim()

      const data = await getTmoChapterPagesWithBrowser(chapterUrl, referer)

      return reply.send({ success: true, data })
    },
  )

  app.get<{ Querystring: OlympusChapterQuerystring }>(
    '/manga/olympus/chapter',
    async (request, reply) => {
      const data = await getOlympusChapterData(
        {
          payloadUrl: request.query.payloadUrl?.trim(),
          chapterUrl: request.query.chapterUrl?.trim(),
          chapterId: request.query.chapterId?.trim(),
          slug: request.query.slug?.trim(),
          type: request.query.type?.trim(),
        },
        request.signal,
      )

      return reply.send({ success: true, data })
    },
  )

  app.post<{ Body: MangaChapterPdfBody }>('/manga/chapter-pdf', async (request, reply) => {
    const title = request.body?.title?.trim() ?? ''
    const pages = request.body?.pages ?? []
    const referer = request.body?.referer?.trim() || undefined

    const pdf = await createMangaChapterPdf({
      title,
      pages,
      referer,
    })

    reply.header('content-type', 'application/pdf')
    reply.header('content-disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(pdf.fileName))

    return reply.send(pdf.buffer)
  })

  app.get<{
    Params: { libraryType: string; id: string; slug: string; chapterId: string }
  }>(
    '/manga/:libraryType/:id/:slug/chapter/:chapterId',
    async (request, reply) => {
      const data = await getMangaReadData(
        request.params.libraryType,
        request.params.id,
        request.params.slug,
        request.params.chapterId,
        request.signal,
      )

      return reply.send({ success: true, data })
    },
  )

  app.get<{ Params: { libraryType: string; id: string; slug: string } }>(
    '/manga/:libraryType/:id/:slug',
    async (request, reply) => {
      const data = await getMangaDetail(
        request.params.libraryType,
        request.params.id,
        request.params.slug,
        request.signal,
      )

      return reply.send({ success: true, data })
    },
  )
}












