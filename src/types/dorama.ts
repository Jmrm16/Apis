import type { EpisodeServer } from './anime.js'

export interface DoramaSeriesCard {
  slug: string
  title: string
  poster: string
  backdrop: string | null
  synopsis: string | null
  status: string | null
  score: string | null
  views: string | null
  sourceUrl: string
}

export interface DoramaEpisodeCard {
  slug: string
  seriesSlug: string
  seriesTitle: string
  title: string
  seasonNumber: number | null
  episodeNumber: number | null
  runtime: string | null
  poster: string | null
  sourceUrl: string
}

export interface DoramaHomeData {
  featured: DoramaSeriesCard[]
  recentEpisodes: DoramaEpisodeCard[]
}

export interface DoramaCatalogPage {
  page: number
  hasNextPage: boolean
  items: DoramaSeriesCard[]
}

export interface DoramaEpisodeLink {
  slug: string
  title: string
  seasonNumber: number | null
  episodeNumber: number | null
  runtime: string | null
  sourceUrl: string
}

export interface DoramaSeriesDetail extends DoramaSeriesCard {
  originalTitle: string | null
  alternativeTitles: string[]
  genres: string[]
  year: string | null
  releaseDate: string | null
  seasonsLabel: string | null
  totalEpisodesLabel: string | null
  duration: string | null
  directors: string[]
  cast: string[]
  episodes: DoramaEpisodeLink[]
}

export interface DoramaEpisodeDetail {
  slug: string
  title: string
  seasonNumber: number | null
  episodeNumber: number | null
  runtime: string | null
  synopsis: string | null
  sourceUrl: string
  servers: EpisodeServer[]
}
