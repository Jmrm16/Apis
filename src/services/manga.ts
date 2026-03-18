import { ApiError } from '../lib/http.js'
import {
  mangaDemoCatalog,
  mangaDemoDetails,
  mangaDemoHome,
  mangaDemoReads,
} from '../data/manga-demo.js'
import type { MangaDetail, MangaHomeData, MangaReadData, MangaSummary } from '../types/manga.js'

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

export async function getMangaHome(): Promise<MangaHomeData> {
  return mangaDemoHome
}

export async function searchManga(query: string): Promise<MangaSummary[]> {
  const cleanQuery = query.trim().toLowerCase()

  if (!cleanQuery) {
    return mangaDemoCatalog
  }

  return mangaDemoCatalog.filter((manga) => {
    return (
      manga.title.toLowerCase().includes(cleanQuery) ||
      manga.synopsis.toLowerCase().includes(cleanQuery) ||
      manga.genres.some((genre) => genre.toLowerCase().includes(cleanQuery))
    )
  })
}

export async function getMangaDetail(
  libraryType: string,
  id: string,
  slug: string,
): Promise<MangaDetail> {
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
): Promise<MangaReadData> {
  const readData = mangaDemoReads.get(createReadKey(libraryType, id, slug, chapterId))

  if (!readData) {
    throw new ApiError('No se encontro el capitulo solicitado.', 404)
  }

  return readData
}
