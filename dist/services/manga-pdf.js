import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { ApiError } from '../lib/http.js';
const REQUEST_HEADERS = {
    Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
};
const MAX_CHAPTER_PAGES = 240;
const MAX_PDF_DIMENSION_PX = 14_400;
function sanitizePdfFilename(value) {
    const normalized = value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._ -]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return `${(normalized || 'capitulo').slice(0, 120)}.pdf`;
}
function normalizePdfSize(width, height) {
    const safeWidth = Math.max(1, Math.round(width));
    const safeHeight = Math.max(1, Math.round(height));
    const scale = Math.min(MAX_PDF_DIMENSION_PX / safeWidth, MAX_PDF_DIMENSION_PX / safeHeight, 1);
    return {
        width: Math.max(1, Math.round(safeWidth * scale)),
        height: Math.max(1, Math.round(safeHeight * scale)),
    };
}
async function fetchImageBuffer(url, referer, signal) {
    const headers = new Headers(REQUEST_HEADERS);
    if (referer) {
        headers.set('Referer', referer);
    }
    const response = await fetch(url, {
        headers,
        signal,
    });
    if (!response.ok) {
        throw new ApiError(`No pude descargar una pagina del capitulo (${response.status}).`, 502);
    }
    return Buffer.from(await response.arrayBuffer());
}
async function preparePdfImage(url, referer, signal) {
    const sourceBytes = await fetchImageBuffer(url, referer, signal);
    const image = sharp(sourceBytes, {
        animated: false,
        pages: 1,
        limitInputPixels: false,
    }).rotate();
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
        throw new ApiError('No pude leer una pagina del capitulo para el PDF.', 502);
    }
    const pdfSize = normalizePdfSize(metadata.width, metadata.height);
    const shouldResize = pdfSize.width !== metadata.width || pdfSize.height !== metadata.height;
    const basePipeline = shouldResize
        ? image.resize({
            width: pdfSize.width,
            height: pdfSize.height,
            fit: 'fill',
        })
        : image;
    const sourceFormat = metadata.format?.toLowerCase();
    if (sourceFormat === 'jpeg' || sourceFormat === 'jpg') {
        return {
            bytes: await basePipeline.jpeg({ quality: 92 }).toBuffer(),
            width: pdfSize.width,
            height: pdfSize.height,
            format: 'jpg',
        };
    }
    return {
        bytes: await basePipeline.png().toBuffer(),
        width: pdfSize.width,
        height: pdfSize.height,
        format: 'png',
    };
}
export async function createMangaChapterPdf(payload, signal) {
    const title = payload.title.trim();
    const referer = payload.referer?.trim() || null;
    const pages = payload.pages
        .map((page) => page.trim())
        .filter(Boolean)
        .slice(0, MAX_CHAPTER_PAGES);
    if (!title) {
        throw new ApiError('Debes enviar un titulo para el PDF.', 400);
    }
    if (pages.length === 0) {
        throw new ApiError('No hay paginas para generar el PDF de este capitulo.', 400);
    }
    const finalDocument = await PDFDocument.create();
    for (const imageUrl of pages) {
        if (signal?.aborted) {
            throw new ApiError('La solicitud fue cancelada.', 499);
        }
        const preparedImage = await preparePdfImage(imageUrl, referer, signal);
        const embeddedImage = preparedImage.format === 'jpg'
            ? await finalDocument.embedJpg(preparedImage.bytes)
            : await finalDocument.embedPng(preparedImage.bytes);
        const page = finalDocument.addPage([preparedImage.width, preparedImage.height]);
        page.drawImage(embeddedImage, {
            x: 0,
            y: 0,
            width: preparedImage.width,
            height: preparedImage.height,
        });
    }
    const bytes = await finalDocument.save();
    return {
        buffer: Buffer.from(bytes),
        fileName: sanitizePdfFilename(title),
    };
}
