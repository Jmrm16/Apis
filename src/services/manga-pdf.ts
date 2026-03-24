import { existsSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { chromium, type Page } from 'playwright-core'
import { env } from '../config/env.js'
import { ApiError } from '../lib/http.js'

const COMMON_BROWSER_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
]

const REQUEST_HEADERS = {
  Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
}

const MAX_CHAPTER_PAGES = 240
const MAX_PDF_DIMENSION_PX = 14_400

export interface MangaChapterPdfPayload {
  title: string
  pages: string[]
  referer?: string | null
}

function findBrowserExecutablePath(): string {
  const configuredPath = env.browserExecutablePath.trim()
  if (configuredPath) {
    return configuredPath
  }

  const detectedPath = COMMON_BROWSER_PATHS.find((path) => existsSync(path))
  if (detectedPath) {
    return detectedPath
  }

  throw new ApiError(
    'No se encontro un navegador compatible para generar el PDF. Configura BROWSER_EXECUTABLE_PATH.',
    500,
  )
}

function sanitizePdfFilename(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._ -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return `${(normalized || 'capitulo').slice(0, 120)}.pdf`
}

function guessMimeType(url: string): string {
  try {
    const pathname = new URL(url).pathname.toLowerCase()

    if (pathname.endsWith('.png')) {
      return 'image/png'
    }

    if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) {
      return 'image/jpeg'
    }

    if (pathname.endsWith('.webp')) {
      return 'image/webp'
    }

    if (pathname.endsWith('.gif')) {
      return 'image/gif'
    }
  } catch {
    // noop
  }

  return 'image/webp'
}

function normalizePdfSize(width: number, height: number) {
  const safeWidth = Math.max(1, Math.round(width))
  const safeHeight = Math.max(1, Math.round(height))
  const scale = Math.min(MAX_PDF_DIMENSION_PX / safeWidth, MAX_PDF_DIMENSION_PX / safeHeight, 1)

  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  }
}

async function fetchImageAsDataUrl(
  url: string,
  referer: string | null,
  signal?: AbortSignal,
): Promise<string> {
  const headers = new Headers(REQUEST_HEADERS)
  if (referer) {
    headers.set('Referer', referer)
  }

  const response = await fetch(url, {
    headers,
    signal,
  })

  if (!response.ok) {
    throw new ApiError(`No pude descargar una pagina del capitulo (${response.status}).`, 502)
  }

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() || guessMimeType(url)
  const bytes = Buffer.from(await response.arrayBuffer())
  return `data:${contentType};base64,${bytes.toString('base64')}`
}

async function renderPdfPage(page: Page, dataUrl: string): Promise<Buffer> {
  await page.setContent(
    `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
      }

      body {
        display: block;
      }

      img {
        display: block;
        width: 100%;
        height: auto;
      }
    </style>
  </head>
  <body>
    <img id="reader-page" alt="chapter page" />
  </body>
</html>`,
    { waitUntil: 'domcontentloaded' },
  )

  const dimensions = await page.evaluate(async (src) => {
    const image = document.getElementById('reader-page') as HTMLImageElement | null
    if (!image) {
      throw new Error('No pude crear la imagen para el PDF.')
    }

    return await new Promise<{ width: number; height: number }>((resolve, reject) => {
      image.onload = () => {
        resolve({
          width: image.naturalWidth || image.width || 1,
          height: image.naturalHeight || image.height || 1,
        })
      }
      image.onerror = () => reject(new Error('No pude cargar una pagina para el PDF.'))
      image.src = src
    })
  }, dataUrl)

  const pdfSize = normalizePdfSize(dimensions.width, dimensions.height)

  await page.setViewportSize({
    width: Math.min(Math.max(pdfSize.width, 1), 2_000),
    height: Math.min(Math.max(pdfSize.height, 1), 2_000),
  })

  await page.evaluate(({ width, height }) => {
    const image = document.getElementById('reader-page') as HTMLImageElement | null
    if (!image) {
      return
    }

    image.style.width = `${width}px`
    image.style.height = `${height}px`
    document.body.style.width = `${width}px`
    document.body.style.height = `${height}px`
  }, pdfSize)

  return page.pdf({
    printBackground: true,
    width: `${pdfSize.width}px`,
    height: `${pdfSize.height}px`,
    margin: {
      top: '0px',
      right: '0px',
      bottom: '0px',
      left: '0px',
    },
    pageRanges: '1',
  })
}

export async function createMangaChapterPdf(
  payload: MangaChapterPdfPayload,
  signal?: AbortSignal,
): Promise<{ buffer: Buffer; fileName: string }> {
  const title = payload.title.trim()
  const referer = payload.referer?.trim() || null
  const pages = payload.pages
    .map((page) => page.trim())
    .filter(Boolean)
    .slice(0, MAX_CHAPTER_PAGES)

  if (!title) {
    throw new ApiError('Debes enviar un titulo para el PDF.', 400)
  }

  if (pages.length === 0) {
    throw new ApiError('No hay paginas para generar el PDF de este capitulo.', 400)
  }

  const executablePath = findBrowserExecutablePath()
  const browser = await chromium.launch({
    executablePath,
    headless: env.browserHeadless,
    args: ['--disable-blink-features=AutomationControlled'],
  })

  try {
    const context = await browser.newContext({
      locale: 'es-CO',
      userAgent: REQUEST_HEADERS['User-Agent'],
    })
    const page = await context.newPage()
    const finalDocument = await PDFDocument.create()

    try {
      for (const imageUrl of pages) {
        if (signal?.aborted) {
          throw new ApiError('La solicitud fue cancelada.', 499)
        }

        const dataUrl = await fetchImageAsDataUrl(imageUrl, referer, signal)
        const singlePagePdf = await renderPdfPage(page, dataUrl)
        const sourceDocument = await PDFDocument.load(singlePagePdf)
        const copiedPages = await finalDocument.copyPages(sourceDocument, sourceDocument.getPageIndices())

        for (const copiedPage of copiedPages) {
          finalDocument.addPage(copiedPage)
        }
      }
    } finally {
      await context.close()
    }

    const bytes = await finalDocument.save()

    return {
      buffer: Buffer.from(bytes),
      fileName: sanitizePdfFilename(title),
    }
  } finally {
    await browser.close()
  }
}
