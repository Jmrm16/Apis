import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { env } from '../config/env.js';
import { ApiError } from '../lib/http.js';
const DEFAULT_LIMIT = 48;
const MAX_LIMIT = 120;
const MIN_CACHE_TTL_MS = 60_000;
const URL_PATTERN = /https?:\/\/[^,\s#]+/g;
let officialCache = null;
let pendingOfficialRequest = null;
function normalizeQuery(value) {
    return value?.trim() ?? '';
}
function normalizeLanguage(value) {
    const normalized = value?.trim().toLowerCase();
    return normalized ? normalized : null;
}
function normalizePage(value) {
    return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : 1;
}
function normalizeLimit(value) {
    if (!Number.isFinite(value) || !value || value <= 0) {
        return DEFAULT_LIMIT;
    }
    return Math.min(Math.floor(value), MAX_LIMIT);
}
function normalizeNsfw(value) {
    if (value === 'all' || value === 'nsfw') {
        return value;
    }
    return 'safe';
}
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeOptionalUrl(value) {
    const text = normalizeText(value);
    return text || null;
}
function isLocalHost(host) {
    return host === 'localhost' || host === '127.0.0.1';
}
function parseBaseUrls(rawValue) {
    const normalized = rawValue.trim();
    if (!normalized) {
        return [];
    }
    const matches = normalized.match(URL_PATTERN);
    if (matches && matches.length > 0) {
        return [...new Set(matches)];
    }
    return [normalized];
}
function getHost(value) {
    if (!value) {
        return null;
    }
    try {
        return new URL(value).hostname.replace(/^www\./i, '').toLowerCase();
    }
    catch {
        return null;
    }
}
function getSiteType(baseUrls, host) {
    if (baseUrls.length === 0) {
        return 'configurable';
    }
    return isLocalHost(host) ? 'local' : 'remote';
}
function mapSourceRecord(extension, source, catalog) {
    const baseUrls = parseBaseUrls(source.baseUrl);
    const baseUrl = baseUrls[0] ?? null;
    const host = getHost(baseUrl);
    return {
        key: `${catalog.id}:${extension.pkg}:${source.id}`,
        sourceName: source.name,
        sourceLang: source.lang?.trim().toLowerCase() || extension.lang?.trim().toLowerCase() || 'all',
        sourceId: source.id,
        baseUrl,
        baseUrls,
        host,
        isNsfw: extension.nsfw === 1,
        extensionName: extension.name,
        extensionPackage: extension.pkg,
        extensionApk: extension.apk,
        extensionVersion: extension.version,
        extensionLang: extension.lang?.trim().toLowerCase() || 'all',
        extensionCode: Number(extension.code) || 0,
        siteType: getSiteType(baseUrls, host),
        catalogId: catalog.id,
        catalogName: catalog.name,
        catalogOrigin: catalog.origin,
    };
}
function buildStats(catalogs, sources) {
    const languageMap = new Map();
    for (const item of sources) {
        languageMap.set(item.sourceLang, (languageMap.get(item.sourceLang) ?? 0) + 1);
    }
    const languages = [...languageMap.entries()]
        .map(([code, count]) => ({ code, count }))
        .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));
    const nsfwSources = sources.filter((item) => item.isNsfw).length;
    const officialSources = sources.filter((item) => item.catalogOrigin === 'official').length;
    const importedSources = sources.length - officialSources;
    return {
        totalExtensions: catalogs.reduce((total, catalog) => total + catalog.extensions.length, 0),
        totalSources: sources.length,
        safeSources: sources.length - nsfwSources,
        nsfwSources,
        officialSources,
        importedSources,
        importedCatalogs: catalogs.filter((catalog) => catalog.origin === 'imported').length,
        languages,
    };
}
async function ensureImportsFile() {
    await mkdir(dirname(env.mihonImportsFilePath), { recursive: true });
    try {
        await readFile(env.mihonImportsFilePath, 'utf8');
    }
    catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message.includes('ENOENT')) {
            await writeFile(env.mihonImportsFilePath, '[]', 'utf8');
            return;
        }
        throw error;
    }
}
async function readImportedCatalogs() {
    await ensureImportsFile();
    const raw = await readFile(env.mihonImportsFilePath, 'utf8');
    if (!raw.trim()) {
        return [];
    }
    const payload = JSON.parse(raw);
    if (!Array.isArray(payload)) {
        return [];
    }
    return payload.filter((item) => {
        return Boolean(item && typeof item === 'object' && Array.isArray(item.extensions));
    });
}
async function writeImportedCatalogs(catalogs) {
    await ensureImportsFile();
    await writeFile(env.mihonImportsFilePath, JSON.stringify(catalogs, null, 2), 'utf8');
}
function normalizeRepoSource(source, extensionPackage, index) {
    if (!source || typeof source !== 'object') {
        return null;
    }
    const raw = source;
    const name = normalizeText(raw.name) || `Source ${index + 1}`;
    const lang = normalizeText(raw.lang).toLowerCase() || 'all';
    const id = normalizeText(raw.id) || `${extensionPackage}:${index + 1}`;
    const baseUrl = normalizeText(raw.baseUrl);
    return {
        name,
        lang,
        id,
        baseUrl,
    };
}
function normalizeRepoExtension(extension, index) {
    if (!extension || typeof extension !== 'object') {
        return null;
    }
    const raw = extension;
    const pkg = normalizeText(raw.pkg) || `imported.catalog.extension.${index + 1}`;
    const sources = Array.isArray(raw.sources)
        ? raw.sources
            .map((source, sourceIndex) => normalizeRepoSource(source, pkg, sourceIndex))
            .filter((item) => Boolean(item))
        : [];
    if (sources.length === 0) {
        return null;
    }
    return {
        name: normalizeText(raw.name) || pkg,
        pkg,
        apk: normalizeText(raw.apk) || `${pkg}.apk`,
        lang: normalizeText(raw.lang).toLowerCase() || 'all',
        code: Number(raw.code) || index + 1,
        version: normalizeText(raw.version) || '0.0.0',
        nsfw: raw.nsfw === 1 ? 1 : 0,
        sources,
    };
}
function coercePayloadToExtensions(payload) {
    const rawExtensions = Array.isArray(payload)
        ? payload
        : payload && typeof payload === 'object' && Array.isArray(payload.extensions)
            ? payload.extensions
            : payload && typeof payload === 'object' && Array.isArray(payload.data)
                ? payload.data
                : null;
    if (!rawExtensions) {
        throw new ApiError('El catalogo importado no tiene un formato compatible.', 400);
    }
    const normalized = rawExtensions
        .map((extension, index) => normalizeRepoExtension(extension, index))
        .filter((item) => Boolean(item));
    if (normalized.length === 0) {
        throw new ApiError('No encontre extensiones validas dentro del catalogo importado.', 400);
    }
    return normalized;
}
function buildImportedCatalogName(name, repoUrl, existingCount) {
    if (name) {
        return name;
    }
    const host = getHost(repoUrl);
    if (host) {
        return `Importado ${host}`;
    }
    return `Catalogo importado ${existingCount + 1}`;
}
function buildImportedCatalogRecord(catalog) {
    const sourceCount = catalog.extensions.reduce((total, extension) => total + extension.sources.length, 0);
    return {
        id: catalog.id,
        name: catalog.name,
        repoUrl: catalog.repoUrl,
        importedAt: catalog.importedAt,
        extensionCount: catalog.extensions.length,
        sourceCount,
    };
}
async function fetchOfficialRepo(forceRefresh = false) {
    const cacheTtlMs = Math.max(env.mihonRepoCacheTtlMs, MIN_CACHE_TTL_MS);
    const now = Date.now();
    if (!forceRefresh && officialCache && now - officialCache.fetchedAt < cacheTtlMs) {
        return officialCache;
    }
    if (pendingOfficialRequest) {
        return pendingOfficialRequest;
    }
    pendingOfficialRequest = (async () => {
        try {
            const response = await fetch(env.mihonRepoUrl, {
                headers: {
                    Accept: 'application/json',
                },
            });
            if (!response.ok) {
                throw new ApiError('No pude descargar el indice de Mihon/Keiyoushi.', 502);
            }
            const payload = (await response.json());
            const extensions = coercePayloadToExtensions(payload);
            const nextCache = {
                repoUrl: env.mihonRepoUrl,
                fetchedAt: Date.now(),
                extensions,
            };
            officialCache = nextCache;
            return nextCache;
        }
        catch (error) {
            if (officialCache) {
                return officialCache;
            }
            if (error instanceof ApiError) {
                throw error;
            }
            throw new ApiError('No pude cargar el indice de Mihon/Keiyoushi.', 502);
        }
        finally {
            pendingOfficialRequest = null;
        }
    })();
    return pendingOfficialRequest;
}
async function getRuntimeCatalogs(forceRefresh = false) {
    const [official, imported] = await Promise.all([
        fetchOfficialRepo(forceRefresh),
        readImportedCatalogs(),
    ]);
    return [
        {
            id: 'official',
            name: 'Keiyoushi oficial',
            repoUrl: official.repoUrl,
            fetchedAt: official.fetchedAt,
            origin: 'official',
            extensions: official.extensions,
        },
        ...imported.map((catalog) => ({
            id: catalog.id,
            name: catalog.name,
            repoUrl: catalog.repoUrl ?? env.mihonRepoUrl,
            fetchedAt: new Date(catalog.importedAt).getTime() || Date.now(),
            origin: 'imported',
            extensions: catalog.extensions,
        })),
    ];
}
function matchesQuery(item, query) {
    if (!query) {
        return true;
    }
    const normalized = query.toLowerCase();
    const candidates = [
        item.sourceName,
        item.sourceLang,
        item.sourceId,
        item.host ?? '',
        item.baseUrl ?? '',
        item.extensionName,
        item.extensionPackage,
        item.extensionApk,
        item.extensionVersion,
        item.catalogName,
    ];
    return candidates.some((value) => value.toLowerCase().includes(normalized));
}
function matchesLanguage(item, lang) {
    return !lang || item.sourceLang === lang;
}
function matchesNsfw(item, nsfw) {
    if (nsfw === 'all') {
        return true;
    }
    if (nsfw === 'nsfw') {
        return item.isNsfw;
    }
    return !item.isNsfw;
}
export async function getMihonCatalog(filters = {}) {
    const query = normalizeQuery(filters.query);
    const lang = normalizeLanguage(filters.lang);
    const nsfw = normalizeNsfw(filters.nsfw);
    const page = normalizePage(filters.page);
    const limit = normalizeLimit(filters.limit);
    const catalogs = await getRuntimeCatalogs(Boolean(filters.refresh));
    const sources = catalogs
        .flatMap((catalog) => catalog.extensions.flatMap((extension) => extension.sources.map((source) => mapSourceRecord(extension, source, catalog))))
        .sort((left, right) => {
        const originDiff = left.catalogOrigin.localeCompare(right.catalogOrigin);
        if (originDiff !== 0) {
            return originDiff;
        }
        return (left.sourceName.localeCompare(right.sourceName, 'es', { sensitivity: 'base' }) ||
            left.sourceLang.localeCompare(right.sourceLang) ||
            left.catalogName.localeCompare(right.catalogName, 'es', { sensitivity: 'base' }) ||
            left.extensionName.localeCompare(right.extensionName, 'es', { sensitivity: 'base' }));
    });
    const filtered = sources.filter((item) => {
        return matchesQuery(item, query) && matchesLanguage(item, lang) && matchesNsfw(item, nsfw);
    });
    const totalItems = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * limit;
    const items = filtered.slice(start, start + limit);
    return {
        repoUrl: env.mihonRepoUrl,
        fetchedAt: new Date(Math.max(...catalogs.map((catalog) => catalog.fetchedAt), Date.now())).toISOString(),
        query,
        lang,
        nsfw,
        page: safePage,
        limit,
        totalItems,
        totalPages,
        filteredCount: totalItems,
        stats: buildStats(catalogs, sources),
        items,
    };
}
export async function getMihonImportedCatalogs() {
    const catalogs = await readImportedCatalogs();
    return catalogs
        .map((catalog) => buildImportedCatalogRecord(catalog))
        .sort((left, right) => right.importedAt.localeCompare(left.importedAt));
}
export async function importMihonCatalog(input) {
    const repoUrl = normalizeOptionalUrl(input.repoUrl);
    const jsonText = normalizeText(input.jsonText);
    if (!repoUrl && !jsonText) {
        throw new ApiError('Necesito una URL o un JSON para importar el catalogo.', 400);
    }
    let payload;
    if (jsonText) {
        try {
            payload = JSON.parse(jsonText);
        }
        catch {
            throw new ApiError('El JSON pegado no es valido.', 400);
        }
    }
    else {
        const response = await fetch(repoUrl, {
            headers: {
                Accept: 'application/json',
            },
        });
        if (!response.ok) {
            throw new ApiError('No pude descargar el catalogo remoto que quieres importar.', 502);
        }
        payload = (await response.json());
    }
    const extensions = coercePayloadToExtensions(payload);
    const storedCatalogs = await readImportedCatalogs();
    const existing = repoUrl
        ? storedCatalogs.find((catalog) => catalog.repoUrl?.trim().toLowerCase() === repoUrl.toLowerCase())
        : null;
    const nextCatalog = {
        id: existing?.id ?? randomUUID(),
        name: buildImportedCatalogName(normalizeText(input.name), repoUrl, storedCatalogs.length),
        repoUrl,
        importedAt: new Date().toISOString(),
        extensions,
    };
    const nextCatalogs = existing
        ? storedCatalogs.map((catalog) => (catalog.id === existing.id ? nextCatalog : catalog))
        : [nextCatalog, ...storedCatalogs];
    await writeImportedCatalogs(nextCatalogs);
    return {
        catalog: buildImportedCatalogRecord(nextCatalog),
    };
}
export async function removeMihonImportedCatalog(catalogId) {
    const normalizedId = normalizeText(catalogId);
    if (!normalizedId || normalizedId === 'official') {
        throw new ApiError('Ese catalogo no se puede eliminar.', 400);
    }
    const storedCatalogs = await readImportedCatalogs();
    const nextCatalogs = storedCatalogs.filter((catalog) => catalog.id !== normalizedId);
    if (nextCatalogs.length === storedCatalogs.length) {
        throw new ApiError('No encontre el catalogo importado que quieres borrar.', 404);
    }
    await writeImportedCatalogs(nextCatalogs);
}
