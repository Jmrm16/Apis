import { ApiError } from '../lib/http.js';
import { getOlympusMangaDetail, getOlympusMangaHome, getOlympusMangaReadData, isOlympusMangaLibrary, searchOlympusManga, } from './olympus.js';
import { mangaDemoCatalog, mangaDemoDetails, mangaDemoHome, mangaDemoReads, } from '../data/manga-demo.js';
function createDetailKey(libraryType, id, slug) {
    return `${libraryType}:${id}:${slug}`;
}
function createReadKey(libraryType, id, slug, chapterId) {
    return `${libraryType}:${id}:${slug}:${chapterId}`;
}
export async function getMangaHome(signal) {
    try {
        return await getOlympusMangaHome(signal);
    }
    catch {
        return mangaDemoHome;
    }
}
export async function searchManga(query, signal) {
    if (!query.trim()) {
        try {
            const home = await getOlympusMangaHome(signal);
            return home.trending;
        }
        catch {
            return mangaDemoCatalog;
        }
    }
    try {
        const results = await searchOlympusManga(query, signal);
        if (results.length > 0) {
            return results;
        }
    }
    catch {
        // fallback below
    }
    const cleanQuery = query.trim().toLowerCase();
    return mangaDemoCatalog.filter((manga) => {
        return (manga.title.toLowerCase().includes(cleanQuery) ||
            manga.synopsis.toLowerCase().includes(cleanQuery) ||
            manga.genres.some((genre) => genre.toLowerCase().includes(cleanQuery)));
    });
}
export async function getMangaDetail(libraryType, id, slug, signal) {
    if (isOlympusMangaLibrary(libraryType)) {
        return getOlympusMangaDetail(libraryType, id, slug, signal);
    }
    const detail = mangaDemoDetails.get(createDetailKey(libraryType, id, slug));
    if (!detail) {
        throw new ApiError('No se encontro el manga solicitado.', 404);
    }
    return detail;
}
export async function getMangaReadData(libraryType, id, slug, chapterId, signal) {
    if (isOlympusMangaLibrary(libraryType)) {
        return getOlympusMangaReadData(libraryType, id, slug, chapterId, signal);
    }
    const readData = mangaDemoReads.get(createReadKey(libraryType, id, slug, chapterId));
    if (!readData) {
        throw new ApiError('No se encontro el capitulo solicitado.', 404);
    }
    return readData;
}
