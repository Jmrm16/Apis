import { requestJson } from '../lib/http.js'
import type {
  AnimeDetail,
  AnimeEpisodeLink,
  AnimeStatusCode,
  AnimeSummary,
  EpisodeDetail,
  EpisodeSummary,
  SearchParams,
  SearchResultPage,
} from '../types/anime.js'
import type { AnimeProvider } from './types.js'

interface AnimeFlvListItem {
  title: string
  type: string
  slug: string
  url: string
}

interface AnimeFlvEpisodeListItem {
  title: string
  number: number
  cover?: string
  slug: string
  url: string
}

interface AnimeFlvSearchMediaItem {
  title: string
  cover?: string
  synopsis?: string
  rating?: string
  slug: string
  type: string
  url?: string
}

interface AnimeFlvSearchResponse {
  currentPage: number
  hasNextPage: boolean
  previousPage?: string | null
  nextPage?: string | null
  foundPages: number
  media: AnimeFlvSearchMediaItem[]
}

interface AnimeFlvDetailResponse {
  title: string
  alternative_titles?: string[]
  status?: string
  rating?: string
  type: string
  cover?: string
  synopsis?: string
  genres?: string[]
  next_airing_episode?: string | null
  episodes: Array<{
    number: number
    slug: string
    url: string
  }>
  url?: string
  related?: Array<{
    title: string
    relation: string
    slug: string
    url?: string
  }>
}

interface AnimeFlvEpisodeResponse {
  title: string
  number: number
  servers: Array<{
    name: string
    download?: string
    embed?: string
  }>
}

function extractAnimeSlugFromEpisodeSlug(episodeSlug: string, number: number): string {
  const suffix = `-${number}`

  if (episodeSlug.endsWith(suffix)) {
    return episodeSlug.slice(0, -suffix.length)
  }

  return episodeSlug
}

function normalizeEpisodeLinks(episodes: AnimeEpisodeLink[]): AnimeEpisodeLink[] {
  const episodeMap = new Map<number, AnimeEpisodeLink>()

  for (const episode of episodes) {
    if (!Number.isFinite(episode.number) || episode.number <= 0) {
      continue
    }

    const current = episodeMap.get(episode.number)

    if (!current || (!current.url && episode.url) || (!current.slug && episode.slug)) {
      episodeMap.set(episode.number, episode)
    }
  }

  return [...episodeMap.values()].sort((left, right) => left.number - right.number)
}

function mapAnimeFlvSummary(item: AnimeFlvListItem): AnimeSummary {
  return {
    title: item.title,
    slug: item.slug,
    type: item.type,
    url: item.url,
  }
}

function mapSearchItem(item: AnimeFlvSearchMediaItem): AnimeSummary {
  return {
    title: item.title,
    slug: item.slug,
    type: item.type,
    cover: item.cover,
    synopsis: item.synopsis,
    rating: item.rating,
    url: item.url,
  }
}

export function createAnimeFlvProvider(baseUrl: string): AnimeProvider {
  const detailCache = new Map<string, AnimeDetail>()

  async function fetchAnimeDetail(slug: string, signal?: AbortSignal): Promise<AnimeDetail> {
    const cached = detailCache.get(slug)

    if (cached) {
      return cached
    }

    const data = await requestJson<AnimeFlvDetailResponse>(
      baseUrl,
      `/api/anime/${encodeURIComponent(slug)}`,
      signal,
    )

    const detail: AnimeDetail = {
      title: data.title,
      slug,
      type: data.type,
      cover: data.cover,
      synopsis: data.synopsis,
      rating: data.rating,
      alternativeTitles: data.alternative_titles ?? [],
      status: data.status,
      genres: data.genres ?? [],
      nextAiringEpisode: data.next_airing_episode ?? null,
      episodes: normalizeEpisodeLinks(data.episodes ?? []),
      related: data.related ?? [],
      url: data.url,
    }

    detailCache.set(slug, detail)
    return detail
  }

  async function enrichOnAirSummary(
    item: AnimeFlvListItem,
    signal?: AbortSignal,
  ): Promise<AnimeSummary> {
    try {
      const detail = await fetchAnimeDetail(item.slug, signal)

      return {
        title: item.title,
        slug: item.slug,
        type: item.type,
        cover: detail.cover,
        synopsis: detail.synopsis,
        rating: detail.rating,
        url: item.url,
      }
    } catch {
      return mapAnimeFlvSummary(item)
    }
  }

  async function enrichRelatedAnime(
    item: AnimeDetail['related'][number],
    signal?: AbortSignal,
  ): Promise<AnimeDetail['related'][number]> {
    try {
      const detail = await fetchAnimeDetail(item.slug, signal)
      return {
        ...item,
        cover: detail.cover,
      }
    } catch {
      return item
    }
  }

  return {
    key: 'animeflv',
    label: 'AnimeFLV Adapter',

    async getLatestEpisodes(signal) {
      const data = await requestJson<AnimeFlvEpisodeListItem[]>(
        baseUrl,
        '/api/list/latest-episodes',
        signal,
      )

      return data.map((item) => ({
        title: item.title,
        animeSlug: extractAnimeSlugFromEpisodeSlug(item.slug, item.number),
        episodeSlug: item.slug,
        number: item.number,
        cover: item.cover,
        url: item.url,
      }))
    },

    async getOnAir(signal) {
      const data = await requestJson<AnimeFlvListItem[]>(baseUrl, '/api/list/animes-on-air', signal)
      return Promise.all(data.map((item) => enrichOnAirSummary(item, signal)))
    },

    async search(params, signal) {
      const query = params.query.trim()
      const hasFilters =
        params.genres.length > 0 || params.statuses.length > 0 || params.types.length > 0

      if (!query && !hasFilters) {
        return {
          currentPage: 1,
          hasNextPage: false,
          previousPage: null,
          nextPage: null,
          foundPages: 0,
          media: [],
          mode: 'filter',
        }
      }

      if (query) {
        const searchParams = new URLSearchParams({
          query,
          page: String(params.page),
        })

        const data = await requestJson<AnimeFlvSearchResponse>(
          baseUrl,
          `/api/search?${searchParams.toString()}`,
          signal,
        )

        return {
          ...data,
          media: data.media.map(mapSearchItem),
          mode: 'text',
        }
      }

      const searchParams = new URLSearchParams({
        page: String(params.page),
      })

      if (params.order !== 'default') {
        searchParams.set('order', params.order)
      }

      const data = await requestJson<AnimeFlvSearchResponse>(
        baseUrl,
        `/api/search/by-filter?${searchParams.toString()}`,
        signal,
        {
          method: 'POST',
          body: JSON.stringify({
            genres: params.genres,
            statuses: params.statuses,
            types: params.types,
          }),
        },
      )

      return {
        ...data,
        media: data.media.map(mapSearchItem),
        mode: 'filter',
      }
    },

    async getAnimeBySlug(slug, signal) {
      const detail = await fetchAnimeDetail(slug, signal)
      const related = await Promise.all(
        detail.related.map((item) => enrichRelatedAnime(item, signal)),
      )

      return {
        ...detail,
        related,
      }
    },

    async getEpisodeByNumber(animeSlug, episodeNumber, signal) {
      const data = await requestJson<AnimeFlvEpisodeResponse>(
        baseUrl,
        `/api/anime/${encodeURIComponent(animeSlug)}/episode/${episodeNumber}`,
        signal,
      )

      return {
        animeSlug,
        title: data.title,
        number: data.number,
        servers: data.servers.map((server) => ({
          name: server.name,
          download: server.download ?? null,
          embed: server.embed ?? null,
        })),
      }
    },
  }
}

