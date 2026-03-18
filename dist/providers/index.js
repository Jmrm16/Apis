import { env } from '../config/env.js';
import { createAnimeFlvProvider } from './animeflv.js';
export function getProvider() {
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
    ];
}
