import { ApiError } from '../lib/http.js';
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_ACTIVE_DOWNLOADS = 8;
const MAX_WAITING_DOWNLOADS = 32;
const DOWNLOAD_WAIT_TIMEOUT_MS = 8_000;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']);
function validateImageUrl(value) {
    let url;
    try {
        url = new URL(value ?? '');
    }
    catch {
        throw new ApiError('La direccion de la pagina no es valida.', 400);
    }
    if (url.protocol !== 'https:' || url.hostname !== 'img2mw.xyz' ||
        url.port || url.username || url.password || url.search || url.hash ||
        !url.pathname.startsWith('/manhwas/') ||
        !/\.(?:jpe?g|png|webp|avif|gif)$/i.test(url.pathname)) {
        throw new ApiError('Esta direccion no es una pagina de ManhwaWeb permitida.', 400);
    }
    return url.toString();
}
async function downloadImage(url, upstreamFetch) {
    const response = await upstreamFetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(25_000),
        headers: {
            Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif',
            Referer: 'https://manhwaweb.com/',
            'User-Agent': 'Mozilla/5.0',
        },
    });
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    if (!response.ok || !IMAGE_TYPES.has(contentType) || !response.body) {
        await response.body?.cancel();
        throw new ApiError('La fuente no pudo entregar esta pagina. Reintenta en unos segundos.', 502);
    }
    if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) {
        await response.body.cancel();
        throw new ApiError('La pagina supera el tamano permitido.', 502);
    }
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            bytes += value.byteLength;
            if (bytes > MAX_IMAGE_BYTES) {
                await reader.cancel();
                throw new ApiError('La pagina supera el tamano permitido.', 502);
            }
            chunks.push(value);
        }
    }
    finally {
        reader.releaseLock();
    }
    if (bytes === 0)
        throw new ApiError('La fuente devolvio una pagina vacia.', 502);
    return { body: Buffer.concat(chunks, bytes), contentType, expiresAt: Date.now() + CACHE_TTL_MS };
}
export const mangaImageRoutes = async (app, options) => {
    const upstreamFetch = options.upstreamFetch ?? fetch;
    const cache = new Map();
    const pending = new Map();
    const waitingDownloads = [];
    let cacheBytes = 0;
    let activeDownloads = 0;
    async function acquireDownloadSlot() {
        if (activeDownloads < MAX_ACTIVE_DOWNLOADS) {
            activeDownloads += 1;
            return;
        }
        if (waitingDownloads.length >= MAX_WAITING_DOWNLOADS) {
            throw new ApiError('El lector esta ocupado. Reintenta esta pagina.', 503);
        }
        await new Promise((resolve, reject) => {
            const waiter = {
                resolve: () => {
                    clearTimeout(waiter.timeout);
                    resolve();
                },
                reject,
                timeout: setTimeout(() => {
                    const index = waitingDownloads.indexOf(waiter);
                    if (index >= 0)
                        waitingDownloads.splice(index, 1);
                    reject(new ApiError('El lector esta ocupado. Reintenta esta pagina.', 503));
                }, DOWNLOAD_WAIT_TIMEOUT_MS),
            };
            waitingDownloads.push(waiter);
        });
    }
    function releaseDownloadSlot() {
        const next = waitingDownloads.shift();
        if (next) {
            next.resolve();
            return;
        }
        activeDownloads = Math.max(0, activeDownloads - 1);
    }
    function removeCached(url, image) {
        cache.delete(url);
        cacheBytes -= image.body.byteLength;
    }
    app.get('/manga/manhwaweb/image', async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        const url = validateImageUrl(request.query.url);
        for (const [key, image] of cache) {
            if (image.expiresAt <= Date.now())
                removeCached(key, image);
        }
        let image = cache.get(url);
        if (image) {
            cache.delete(url);
            cache.set(url, image);
        }
        else {
            let download = pending.get(url);
            if (!download) {
                download = (async () => {
                    let acquired = false;
                    try {
                        await acquireDownloadSlot();
                        acquired = true;
                        const result = await downloadImage(url, upstreamFetch);
                        for (const [key, cached] of cache) {
                            if (cacheBytes + result.body.byteLength <= MAX_CACHE_BYTES)
                                break;
                            removeCached(key, cached);
                        }
                        cache.set(url, result);
                        cacheBytes += result.body.byteLength;
                        return result;
                    }
                    finally {
                        if (acquired)
                            releaseDownloadSlot();
                        pending.delete(url);
                    }
                })();
                pending.set(url, download);
            }
            try {
                image = await download;
            }
            catch (error) {
                if (error instanceof ApiError)
                    throw error;
                throw new ApiError('No se pudo cargar esta pagina. Reintenta en unos segundos.', 502);
            }
        }
        return reply
            .header('Cache-Control', 'public, max-age=300')
            .header('X-Content-Type-Options', 'nosniff')
            .type(image.contentType)
            .send(image.body);
    });
};
