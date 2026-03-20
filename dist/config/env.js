import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Load backend/.env relative to this file so deployment cwd does not matter.
dotenv.config({ path: resolve(__dirname, '../../.env') });
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
    provider: process.env.ANIME_PROVIDER || 'animemovil',
    animeFlvBaseUrl: process.env.ANIMEFLV_BASE_URL || 'https://animeflv.ahmedrangel.com',
    animeMovilBaseUrl: process.env.ANIMEMOVIL_BASE_URL || 'https://animemovil2.com',
    browserExecutablePath: process.env.BROWSER_EXECUTABLE_PATH || '',
    browserHeadless: process.env.BROWSER_HEADLESS !== 'false',
};
