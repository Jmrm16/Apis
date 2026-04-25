import { ApiError } from '../lib/http.js'
import {
  getOlympusMangaCatalog,
  getOlympusMangaDetail,
  getOlympusMangaHome,
  getOlympusMangaReadData,
  isOlympusMangaLibrary,
  searchOlympusManga,
} from './olympus.js'
import {
  mangaDemoCatalog,
  mangaDemoDetails,
  mangaDemoHome,
  mangaDemoReads,
} from '../data/manga-demo.js'
import type {
  MangaDetail,
  MangaHomeData,
  MangaReadData,
  MangaSummary,
} from '../types/manga.js'

function createDetailKey(libraryType: string, id: string, slug: string): string {
  return `${libraryType}:${id}:${slug}`
}

function createReadKey(
  libraryType: string,
  id: string,
  slug: string,
  chapterId: string,
): string {
  return `${libraryType}:${id}:${slug}:${chapterId}`
}

export async function getMangaHome(signal?: AbortSignal): Promise<MangaHomeData> {
  try {
    return await getOlympusMangaHome(signal)
  } catch {
    return mangaDemoHome
  }
}

export async function searchManga(query: string, signal?: AbortSignal): Promise<MangaSummary[]> {
  const cleanQuery = query.trim()

  if (!cleanQuery) {
    try {
      const home = await getOlympusMangaHome(signal)
      return home.trending
    } catch {
      return mangaDemoCatalog
    }
  }

  if (cleanQuery === '__catalog__') {
    return getOlympusMangaCatalog(signal)
  }

  try {
    const results = await searchOlympusManga(cleanQuery, signal)
    if (results.length > 0) {
      return results
    }
  } catch {
    // fallback below
  }

  const normalizedQuery = cleanQuery.toLowerCase()
  return mangaDemoCatalog.filter((manga) => {
    return (
      manga.title.toLowerCase().includes(normalizedQuery) ||
      manga.synopsis.toLowerCase().includes(normalizedQuery) ||
      manga.genres.some((genre) => genre.toLowerCase().includes(normalizedQuery))
    )
  })
}

export async function getMangaDetail(
  libraryType: string,
  id: string,
  slug: string,
  signal?: AbortSignal,
): Promise<MangaDetail> {
  if (isOlympusMangaLibrary(libraryType)) {
    return getOlympusMangaDetail(libraryType, id, slug, signal)
  }

  const detail = mangaDemoDetails.get(createDetailKey(libraryType, id, slug))

  if (!detail) {
    throw new ApiError('No se encontro el manga solicitado.', 404)
  }

  return detail
}

export async function getMangaReadData(
  libraryType: string,
  id: string,
  slug: string,
  chapterId: string,
  signal?: AbortSignal,
): Promise<MangaReadData> {
  if (isOlympusMangaLibrary(libraryType)) {
    return getOlympusMangaReadData(libraryType, id, slug, chapterId, signal)
  }

  const readData = mangaDemoReads.get(createReadKey(libraryType, id, slug, chapterId))

  if (!readData) {
    throw new ApiError('No se encontro el capitulo solicitado.', 404)
  }

  return readData
}
