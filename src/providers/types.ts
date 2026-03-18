import type {
  AnimeDetail,
  AnimeSummary,
  EpisodeDetail,
  EpisodeSummary,
  SearchParams,
  SearchResultPage,
} from '../types/anime.js'

export interface AnimeProvider {
  readonly key: string
  readonly label: string
  getLatestEpisodes(signal?: AbortSignal): Promise<EpisodeSummary[]>
  getOnAir(signal?: AbortSignal): Promise<AnimeSummary[]>
  search(params: SearchParams, signal?: AbortSignal): Promise<SearchResultPage>
  getAnimeBySlug(slug: string, signal?: AbortSignal): Promise<AnimeDetail>
  getEpisodeByNumber(
    animeSlug: string,
    episodeNumber: number,
    signal?: AbortSignal,
  ): Promise<EpisodeDetail>
}
