import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { env } from '../config/env.js';
import { ApiError } from '../lib/http.js';
const DEFAULT_REFERER = 'https://zonatmo.com/';
const COMMON_BROWSER_PATHS = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
function getReaderUrl(url) {
    if (url.includes('/paginated/1')) {
        return url.replace('/paginated/1', '/cascade');
    }
    if (url.includes('/paginated')) {
        return url.replace('/paginated', '/cascade');
    }
    if (url.includes('/cascade/1')) {
        return url.replace('/cascade/1', '/cascade');
    }
    return url;
}
function swapTmoHost(url) {
    if (url.includes('lectortmo.com')) {
        return url.replace('lectortmo.com', 'zonatmo.com');
    }
    if (url.includes('zonatmo.com')) {
        return url.replace('zonatmo.com', 'lectortmo.com');
    }
    return url;
}
function resolveReferer(chapterUrl, referer) {
    const value = referer?.trim();
    if (value) {
        return value;
    }
    try {
        const parsedUrl = new URL(chapterUrl);
        if (parsedUrl.hostname.includes('lectortmo.com') ||
            parsedUrl.hostname.includes('zonatmo.com')) {
            return DEFAULT_REFERER;
        }
        return `${parsedUrl.protocol}//${parsedUrl.host}/`;
    }
    catch {
        return DEFAULT_REFERER;
    }
}
function extractReaderUrlFromHtml(html, fallbackUrl) {
    const cascadeMatch = html.match(/https?:\/\/[^"'\\s]+\/cascade(?:\/1)?/i);
    if (cascadeMatch?.[0]) {
        return getReaderUrl(cascadeMatch[0]);
    }
    const paginatedMatch = html.match(/https?:\/\/[^"'\\s]+\/paginated(?:\/1)?/i);
    if (paginatedMatch?.[0]) {
        return getReaderUrl(paginatedMatch[0]);
    }
    return getReaderUrl(fallbackUrl);
}
function findBrowserExecutablePath() {
    const configuredPath = env.browserExecutablePath.trim();
    if (configuredPath) {
        return configuredPath;
    }
    const detectedPath = COMMON_BROWSER_PATHS.find((path) => existsSync(path));
    if (detectedPath) {
        return detectedPath;
    }
    throw new ApiError('No se encontro un navegador compatible. Configura BROWSER_EXECUTABLE_PATH.', 500);
}
async function scrapeAttempt(chapterUrl, referer) {
    const executablePath = findBrowserExecutablePath();
    const browser = await chromium.launch({
        executablePath,
        headless: env.browserHeadless,
        args: ['--disable-blink-features=AutomationControlled'],
    });
    try {
        const context = await browser.newContext({
            locale: 'es-CO',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
            extraHTTPHeaders: {
                'accept-language': 'es-419,es;q=0.9,en;q=0.8',
            },
        });
        const page = await context.newPage();
        await page.goto(referer, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
        const response = await page.goto(chapterUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
            referer,
        });
        const initialStatus = response?.status() ?? 0;
        if (initialStatus >= 400) {
            throw new ApiError(response?.statusText() || 'TMO rechazo la solicitud.', initialStatus);
        }
        await page.waitForTimeout(1500);
        const resolvedUrl = page.url();
        const initialHtml = await page.content();
        const readerUrl = extractReaderUrlFromHtml(initialHtml, resolvedUrl);
        if (readerUrl !== resolvedUrl) {
            const readerResponse = await page.goto(readerUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 30000,
                referer: resolvedUrl,
            });
            const readerStatus = readerResponse?.status() ?? 0;
            if (readerStatus >= 400) {
                throw new ApiError(readerResponse?.statusText() || 'TMO rechazo la solicitud del lector.', readerStatus);
            }
        }
        await page.waitForTimeout(2000);
        const pages = await page.$$eval('div.img-container img', (images) => images
            .map((image) => image.getAttribute('data-src') || image.getAttribute('src') || '')
            .map((value) => value.trim())
            .filter(Boolean));
        const uniquePages = Array.from(new Set(pages));
        if (uniquePages.length === 0) {
            throw new ApiError('No se encontraron paginas para este capitulo.', 404);
        }
        return {
            source: 'tmo',
            chapterUrl,
            resolvedUrl,
            readerUrl: page.url(),
            referer,
            totalPages: uniquePages.length,
            pages: uniquePages,
        };
    }
    finally {
        await browser.close();
    }
}
export async function getTmoChapterPagesWithBrowser(chapterUrl, referer) {
    const cleanChapterUrl = chapterUrl.trim();
    if (!cleanChapterUrl) {
        throw new ApiError('El parametro chapterUrl es requerido.', 400);
    }
    const primaryReferer = resolveReferer(cleanChapterUrl, referer);
    const alternateChapterUrl = swapTmoHost(cleanChapterUrl);
    const alternateReferer = resolveReferer(alternateChapterUrl, referer);
    const attempts = [
        { chapterUrl: cleanChapterUrl, referer: primaryReferer },
    ];
    if (alternateChapterUrl !== cleanChapterUrl) {
        attempts.push({ chapterUrl: alternateChapterUrl, referer: alternateReferer });
    }
    let lastError;
    for (const attempt of attempts) {
        try {
            return await scrapeAttempt(attempt.chapterUrl, attempt.referer);
        }
        catch (error) {
            lastError = error;
        }
    }
    if (lastError instanceof ApiError) {
        throw lastError;
    }
    throw new ApiError('No fue posible obtener las paginas del capitulo con navegador.', 502);
}
