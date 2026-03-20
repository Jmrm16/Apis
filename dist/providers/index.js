import { env } from '../config/env.js';
import { createAnimeMovilProvider } from './animemovil.js';
import { createAnimeFlvProvider } from './animeflv.js';
export function getProvider() {
    if (env.provider === 'animemovil') {
        return createAnimeMovilProvider(env.animeMovilBaseUrl);
    }
    if (env.provider === 'animeflv') {
        return createAnimeFlvProvider(env.animeFlvBaseUrl);
    }
    return createAnimeFlvProvider(env.animeFlvBaseUrl);
}
export function getAvailableProviders() {
    return [
        {
            key: 'animeflv',
            label: 'AnimeFLV Adapter',
        },
        {
            key: 'animemovil',
            label: 'AnimeMovil Scraper',
        },
    ];
}
