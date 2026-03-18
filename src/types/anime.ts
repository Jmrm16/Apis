export type AnimeStatusCode = 1 | 2 | 3
export type SearchOrder = 'default' | 'updated' | 'added' | 'title' | 'rating'
export type SearchMode = 'text' | 'filter'

export interface AnimeSummary {
  title: string
  slug: string
  type: string
  cover?: string
  synopsis?: string
  rating?: string
  url?: string
}

export interface EpisodeSummary {
  title: string
  animeSlug: string
  episodeSlug: string
  number: number
  cover?: string
  url?: string
}

export interface RelatedAnime {
  title: string
  relation: string
  slug: string
  cover?: string
  url?: string
}

export interface AnimeEpisodeLink {
  number: number
  slug: string
  url?: string
}

export interface AnimeDetail extends AnimeSummary {
  alternativeTitles: string[]
  status?: string
  genres: string[]
  nextAiringEpisode?: string | null
  episodes: AnimeEpisodeLink[]
  related: RelatedAnime[]
}

export interface EpisodeServer {
  name: string
  download?: string | null
  embed?: string | null
}

export interface EpisodeDetail {
  animeSlug: string
  title: string
  number: number
  servers: EpisodeServer[]
}

export interface SearchParams {
  query: string
  page: number
  order: SearchOrder
  genres: string[]
  statuses: AnimeStatusCode[]
  types: string[]
}

export interface SearchResultPage {
  currentPage: number
  hasNextPage: boolean
  previousPage?: string | null
  nextPage?: string | null
  foundPages: number
  media: AnimeSummary[]
  mode: SearchMode
}
