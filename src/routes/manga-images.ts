import type { FastifyPluginAsync } from 'fastify'
import { ApiError } from '../lib/http.js'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_CACHE_BYTES = 32 * 1024 * 1024
const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_ACTIVE_DOWNLOADS = 8
const MAX_WAITING_DOWNLOADS = 32
const DOWNLOAD_WAIT_TIMEOUT_MS = 8_000
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'])

interface CachedImage {
  body: Buffer
  contentType: string
  expiresAt: number
}

interface ImageRouteOptions {
  upstreamFetch?: typeof fetch
}

type ImageSource = 'manhwaweb' | 'imperiomanhua'

interface DownloadWaiter {
  resolve: () => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

function validateImageUrl(value: string | undefined, source: ImageSource): string {
  let url: URL
  try {
    url = new URL(value ?? '')
  } catch {
    throw new ApiError('La direccion de la pagina no es valida.', 400)
  }

  const isValidManhwaWebImage =
    url.protocol === 'https:' &&
    url.hostname === 'img2mw.xyz' &&
    !url.port &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.pathname.startsWith('/manhwas/') &&
    /\.(?:jpe?g|png|webp|avif|gif)$/i.test(url.pathname)
  const isValidImperioImage =
    url.protocol === 'https:' &&
    url.hostname === 'imperiomanhua.com' &&
    !url.port &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.pathname.startsWith('/wp-content/uploads/WP-manga/data/') &&
    /\.(?:jpe?g|png|webp|avif|gif)$/i.test(url.pathname)

  if ((source === 'manhwaweb' && !isValidManhwaWebImage) || (source === 'imperiomanhua' && !isValidImperioImage)) {
    throw new ApiError(
      source === 'manhwaweb'
        ? 'Esta direccion no es una pagina de ManhwaWeb permitida.'
        : 'Esta direccion no es una pagina de ImperioManhua permitida.',
      400,
    )
  }
  return url.toString()
}

async function downloadImage(
  url: string,
  source: ImageSource,
  upstreamFetch: typeof fetch,
): Promise<CachedImage> {
  const response = await upstreamFetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(25_000),
    headers: {
      Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif',
      Referer: source === 'manhwaweb' ? 'https://manhwaweb.com/' : 'https://imperiomanhua.com/',
      'User-Agent': 'Mozilla/5.0',
    },
  })
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
  if (!response.ok || !IMAGE_TYPES.has(contentType) || !response.body) {
    await response.body?.cancel()
    throw new ApiError('La fuente no pudo entregar esta pagina. Reintenta en unos segundos.', 502)
  }
  if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) {
    await response.body.cancel()
    throw new ApiError('La pagina supera el tamano permitido.', 502)
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_IMAGE_BYTES) {
        await reader.cancel()
        throw new ApiError('La pagina supera el tamano permitido.', 502)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  if (bytes === 0) throw new ApiError('La fuente devolvio una pagina vacia.', 502)
  return { body: Buffer.concat(chunks, bytes), contentType, expiresAt: Date.now() + CACHE_TTL_MS }
}

export const mangaImageRoutes: FastifyPluginAsync<ImageRouteOptions> = async (app, options) => {
  const upstreamFetch = options.upstreamFetch ?? fetch
  const cache = new Map<string, CachedImage>()
  const pending = new Map<string, Promise<CachedImage>>()
  const waitingDownloads: DownloadWaiter[] = []
  let cacheBytes = 0
  let activeDownloads = 0

  async function acquireDownloadSlot(): Promise<void> {
    if (activeDownloads < MAX_ACTIVE_DOWNLOADS) {
      activeDownloads += 1
      return
    }
    if (waitingDownloads.length >= MAX_WAITING_DOWNLOADS) {
      throw new ApiError('El lector esta ocupado. Reintenta esta pagina.', 503)
    }
    await new Promise<void>((resolve, reject) => {
      const waiter: DownloadWaiter = {
        resolve: () => {
          clearTimeout(waiter.timeout)
          resolve()
        },
        reject,
        timeout: setTimeout(() => {
          const index = waitingDownloads.indexOf(waiter)
          if (index >= 0) waitingDownloads.splice(index, 1)
          reject(new ApiError('El lector esta ocupado. Reintenta esta pagina.', 503))
        }, DOWNLOAD_WAIT_TIMEOUT_MS),
      }
      waitingDownloads.push(waiter)
    })
  }

  function releaseDownloadSlot(): void {
    const next = waitingDownloads.shift()
    if (next) {
      next.resolve()
      return
    }
    activeDownloads = Math.max(0, activeDownloads - 1)
  }

  function removeCached(url: string, image: CachedImage) {
    cache.delete(url)
    cacheBytes -= image.body.byteLength
  }

  function registerImageRoute(path: string, source: ImageSource) {
    app.get<{ Querystring: { url?: string } }>(path, async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      const url = validateImageUrl(request.query.url, source)
      for (const [key, image] of cache) {
        if (image.expiresAt <= Date.now()) removeCached(key, image)
      }
      let image = cache.get(url)
      if (image) {
        cache.delete(url)
        cache.set(url, image)
      } else {
        let download = pending.get(url)
        if (!download) {
          download = (async () => {
            let acquired = false
            try {
              await acquireDownloadSlot()
              acquired = true
              const result = await downloadImage(url, source, upstreamFetch)
              for (const [key, cached] of cache) {
                if (cacheBytes + result.body.byteLength <= MAX_CACHE_BYTES) break
                removeCached(key, cached)
              }
              cache.set(url, result)
              cacheBytes += result.body.byteLength
              return result
            } finally {
              if (acquired) releaseDownloadSlot()
              pending.delete(url)
            }
          })()
          pending.set(url, download)
        }
        try {
          image = await download
        } catch (error) {
          if (error instanceof ApiError) throw error
          throw new ApiError('No se pudo cargar esta pagina. Reintenta en unos segundos.', 502)
        }
      }
      return reply
        .header('Cache-Control', 'public, max-age=300')
        .header('X-Content-Type-Options', 'nosniff')
        .type(image.contentType)
        .send(image.body)
    })
  }

  registerImageRoute('/manga/manhwaweb/image', 'manhwaweb')
  registerImageRoute('/manga/imperiomanhua/image', 'imperiomanhua')
}
