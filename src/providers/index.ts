import { env } from '../config/env.js'
import { createAnimeMovilProvider } from './animemovil.js'
import { createAnimeFlvProvider } from './animeflv.js'
import type { AnimeProvider } from './types.js'

export function getProvider(): AnimeProvider {
  if (env.provider === 'animemovil') {
    return createAnimeMovilProvider(env.animeMovilBaseUrl)
  }

  if (env.provider === 'animeflv') {
    return createAnimeFlvProvider(env.animeFlvBaseUrl)
  }

  return createAnimeFlvProvider(env.animeFlvBaseUrl)
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
  ]
}
