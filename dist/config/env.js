import 'dotenv/config';
const defaultCorsOrigins = [
    'http://localhost:5173',
    'https://anime-c9350.web.app',
    'https://anime-c9350.firebaseapp.com',
];
function parseCorsOrigin(value) {
    const normalized = value?.trim();
    if (normalized === '*') {
        return '*';
    }
    const configuredOrigins = normalized
        ? normalized.split(',').map((origin) => origin.trim()).filter(Boolean)
        : [];
    return [...new Set([...defaultCorsOrigins, ...configuredOrigins])];
}
export const env = {
    port: Number(process.env.PORT || 10000),
    host: process.env.HOST || '0.0.0.0',
    corsOrigin: parseCorsOrigin(process.env.CORS_ORIGIN),
    provider: process.env.ANIME_PROVIDER || 'animeflv',
    animeFlvBaseUrl: process.env.ANIMEFLV_BASE_URL || 'https://animeflv.ahmedrangel.com',
    animeMovilBaseUrl: process.env.ANIMEMOVIL_BASE_URL || 'https://animemovil2.com',
    browserExecutablePath: process.env.BROWSER_EXECUTABLE_PATH || '',
    browserHeadless: process.env.BROWSER_HEADLESS !== 'false',
};
