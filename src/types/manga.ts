export type MangaSource = 'demo' | 'tmo' | 'olympus' | 'namicomi'

export interface MangaSummary {
  id: string
  slug: string
  libraryType: string
  title: string
  cover: string
  synopsis: string
  status: string
  demography: string
  rating: string
  genres: string[]
  chapterCount: number
  sourceUrl: string | null
  source: MangaSource
}

export interface MangaRecentChapter {
  mangaId: string
  mangaSlug: string
  mangaTitle: string
  libraryType: string
  chapterId: string
  chapterSlug: string
  chapterTitle: string
  numberLabel: string
  cover: string
  sourceUrl: string | null
  source?: MangaSource
  publishedAt?: string | null
}

export interface MangaChapterSummary {
  id: string
  slug: string
  title: string
  numberLabel: string
  shortTitle: string
  cover: string
  sourceUrl: string | null
  publishedAt?: string | null
}

export interface MangaHomeData {
  featured: MangaSummary
  trending: MangaSummary[]
  latestChapters: MangaRecentChapter[]
  spotlight: MangaSummary[]
  source: MangaSource
  notice?: string | null
}

export interface MangaDetail extends MangaSummary {
  description: string
  alternativeTitles: string[]
  chapters: MangaChapterSummary[]
  related: MangaSummary[]
  notice?: string | null
}

export interface MangaReadData {
  manga: MangaSummary
  chapter: MangaChapterSummary
  chapters: MangaChapterSummary[]
  pages: string[]
  readingMode: 'pages' | 'external' | 'maintenance'
  externalUrl: string | null
  source: MangaSource
  notice?: string | null
}

export interface MangaChapterPages {
  source: MangaSource
  chapterUrl: string
  resolvedUrl: string
  readerUrl: string
  referer: string
  totalPages: number
  pages: string[]
}

export interface OlympusChapterData {
  source: 'olympus'
  payloadUrl: string
  routePath: string
  chapterUrl: string
  chapter: {
    id: number | string
    number: string
    title: string | null
    publishedAt: string | null
    viewCount: number
    type: string | null
    pageCount: number
    pages: string[]
    team: {
      id: number | string
      name: string
      cover: string | null
    } | null
  }
  series: {
    id: number | string
    name: string
    slug: string
    url: string
  } | null
  prevChapter: {
    id: number | string
    number: string
    url: string
  } | null
  nextChapter: {
    id: number | string
    number: string
    url: string
  } | null
  recommendedSeries: Array<{
    id: number | string
    name: string
    slug: string
    status: string | null
    cover: string | null
    type: string | null
    url: string
  }>
}
