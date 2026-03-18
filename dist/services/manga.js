import { ApiError } from '../lib/http.js';
import { mangaDemoCatalog, mangaDemoDetails, mangaDemoHome, mangaDemoReads, } from '../data/manga-demo.js';
function createDetailKey(libraryType, id, slug) {
    return `${libraryType}:${id}:${slug}`;
}
function createReadKey(libraryType, id, slug, chapterId) {
    return `${libraryType}:${id}:${slug}:${chapterId}`;
}
export async function getMangaHome() {
    return mangaDemoHome;
}
export async function searchManga(query) {
    const cleanQuery = query.trim().toLowerCase();
    if (!cleanQuery) {
        return mangaDemoCatalog;
    }
    return mangaDemoCatalog.filter((manga) => {
        return (manga.title.toLowerCase().includes(cleanQuery) ||
            manga.synopsis.toLowerCase().includes(cleanQuery) ||
            manga.genres.some((genre) => genre.toLowerCase().includes(cleanQuery)));
    });
}
export async function getMangaDetail(libraryType, id, slug) {
    const detail = mangaDemoDetails.get(createDetailKey(libraryType, id, slug));
    if (!detail) {
        throw new ApiError('No se encontro el manga solicitado.', 404);
    }
    return detail;
}
export async function getMangaReadData(libraryType, id, slug, chapterId) {
    const readData = mangaDemoReads.get(createReadKey(libraryType, id, slug, chapterId));
    if (!readData) {
        throw new ApiError('No se encontro el capitulo solicitado.', 404);
    }
    return readData;
}
