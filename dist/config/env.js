import 'dotenv/config';
export const env = {
    port: Number(process.env.PORT || 10000),
    host: process.env.HOST || '0.0.0.0',
    corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    provider: process.env.ANIME_PROVIDER || 'animeflv',
    animeFlvBaseUrl: process.env.ANIMEFLV_BASE_URL || 'https://animeflv.ahmedrangel.com',
    browserExecutablePath: process.env.BROWSER_EXECUTABLE_PATH || '',
    browserHeadless: process.env.BROWSER_HEADLESS !== 'false',
};
