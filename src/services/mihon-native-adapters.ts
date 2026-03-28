import type { MihonNativeFamilySummary, MihonNativeSupport, MihonSourceRecord } from '../types/mihon.js'

type NativeSupportStatus = MihonNativeSupport['status']
type NativeSupportConfidence = MihonNativeSupport['confidence']

interface NativeAdapterDefinition {
  id: string
  name: string
  status: NativeSupportStatus
  confidence: NativeSupportConfidence
  canOpenNatively: boolean
  appSource: MihonNativeSupport['appSource']
  reason: string
  keywords: string[]
}

const INTEGRATED_ADAPTERS: NativeAdapterDefinition[] = [
  {
    id: 'olympus',
    name: 'Olympus nativo',
    status: 'integrated',
    confidence: 'high',
    canOpenNatively: true,
    appSource: 'olympus',
    reason: 'Ya existe adaptador nativo completo para catalogo, detalle, capitulos y lector.',
    keywords: ['olympus', 'olympusbiblioteca.com', 'dashboard.olympusbiblioteca.com'],
  },
  {
    id: 'manhwaweb',
    name: 'ManhwaWeb nativo',
    status: 'integrated',
    confidence: 'high',
    canOpenNatively: true,
    appSource: 'manhwaweb',
    reason: 'Ya existe adaptador nativo completo para catalogo, detalle, capitulos y lector.',
    keywords: ['manhwaweb', 'manhwaweb.com'],
  },
  {
    id: 'mangadex',
    name: 'MangaDex nativo',
    status: 'integrated',
    confidence: 'high',
    canOpenNatively: true,
    appSource: 'mangadex',
    reason: 'Ya existe adaptador nativo completo usando backend proxy para evitar CORS.',
    keywords: ['mangadex', 'mangadex.org'],
  },
  {
    id: 'namicomi',
    name: 'NamiComi nativo',
    status: 'integrated',
    confidence: 'high',
    canOpenNatively: true,
    appSource: 'namicomi',
    reason: 'Ya existe adaptador nativo completo usando backend proxy para evitar CORS.',
    keywords: ['namicomi', 'namicomi.com'],
  },
]

const CANDIDATE_FAMILIES: NativeAdapterDefinition[] = [
  {
    id: 'mangaplus-api',
    name: 'Familia Manga Plus API',
    status: 'candidate',
    confidence: 'high',
    canOpenNatively: false,
    appSource: null,
    reason: 'Esta fuente parece pertenecer a una API oficial y es buena candidata para un adaptador nativo reutilizable.',
    keywords: ['mangaplus', 'manga plus by shueisha', 'manga plus creators'],
  },
  {
    id: 'cubari-feed',
    name: 'Familia Cubari',
    status: 'candidate',
    confidence: 'high',
    canOpenNatively: false,
    appSource: null,
    reason: 'Cubari y mirrors parecidos se pueden resolver con un adaptador ligero basado en feeds y paginas.',
    keywords: ['cubari', 'cubari.moe'],
  },
  {
    id: 'globalcomix-api',
    name: 'Familia GlobalComix',
    status: 'candidate',
    confidence: 'high',
    canOpenNatively: false,
    appSource: null,
    reason: 'GlobalComix expone una superficie estable para construir un adaptador nativo reutilizable.',
    keywords: ['globalcomix', 'globalcomix.com'],
  },
  {
    id: 'comicfury-family',
    name: 'Familia Comic Fury',
    status: 'candidate',
    confidence: 'medium',
    canOpenNatively: false,
    appSource: null,
    reason: 'Comic Fury comparte estructura suficiente como para intentar un adaptador nativo por familia.',
    keywords: ['comicfury', 'comicfury.com'],
  },
  {
    id: 'comikey-api',
    name: 'Familia Comikey',
    status: 'candidate',
    confidence: 'medium',
    canOpenNatively: false,
    appSource: null,
    reason: 'Comikey tiene una superficie bastante delimitada y puede entrar por adaptador nativo especifico.',
    keywords: ['comikey', 'comikey.com'],
  },
  {
    id: 'tappytoon-api',
    name: 'Familia Tappytoon',
    status: 'candidate',
    confidence: 'medium',
    canOpenNatively: false,
    appSource: null,
    reason: 'Tappytoon es una candidata clara a adaptador nativo dedicado por API o sitio.',
    keywords: ['tappytoon', 'tappytoon.com'],
  },
  {
    id: 'native-html-custom',
    name: 'Adaptador HTML personalizado',
    status: 'candidate',
    confidence: 'low',
    canOpenNatively: false,
    appSource: null,
    reason: 'Fuente remota sin motor identificado. Requiere fingerprint HTML o reglas manuales antes de entrar al lector nativo.',
    keywords: [],
  },
]

function normalizeMatcher(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

function buildHaystack(item: Pick<MihonSourceRecord, 'sourceName' | 'extensionName' | 'extensionPackage' | 'host' | 'baseUrls'>): string {
  return [
    item.sourceName,
    item.extensionName,
    item.extensionPackage,
    item.host ?? '',
    ...item.baseUrls,
  ]
    .map((value) => normalizeMatcher(value))
    .filter(Boolean)
    .join(' ')
}

function toNativeSupport(definition: NativeAdapterDefinition): MihonNativeSupport {
  return {
    status: definition.status,
    adapterId: definition.id,
    adapterName: definition.name,
    confidence: definition.confidence,
    canOpenNatively: definition.canOpenNatively,
    appSource: definition.appSource,
    reason: definition.reason,
  }
}

function matchDefinition(haystack: string, definitions: NativeAdapterDefinition[]): NativeAdapterDefinition | null {
  for (const definition of definitions) {
    if (definition.keywords.some((keyword) => haystack.includes(keyword))) {
      return definition
    }
  }

  return null
}

export function resolveMihonNativeSupport(item: Pick<MihonSourceRecord, 'sourceName' | 'extensionName' | 'extensionPackage' | 'host' | 'baseUrls' | 'siteType'>): MihonNativeSupport {
  if (item.siteType === 'local') {
    return {
      status: 'blocked',
      adapterId: 'local-instance',
      adapterName: 'Instancia local o privada',
      confidence: 'high',
      canOpenNatively: false,
      appSource: null,
      reason: 'Depende de una URL local o privada. No es portable como fuente nativa general para todos los usuarios.',
    }
  }

  if (item.siteType === 'configurable') {
    return {
      status: 'blocked',
      adapterId: 'manual-config',
      adapterName: 'Fuente configurable',
      confidence: 'high',
      canOpenNatively: false,
      appSource: null,
      reason: 'Necesita configuracion manual, host propio o parametros privados antes de poder usarse.',
    }
  }

  const haystack = buildHaystack(item)
  const integrated = matchDefinition(haystack, INTEGRATED_ADAPTERS)
  if (integrated) {
    return toNativeSupport(integrated)
  }

  const candidate = matchDefinition(haystack, CANDIDATE_FAMILIES.filter((definition) => definition.keywords.length > 0))
  if (candidate) {
    return toNativeSupport(candidate)
  }

  return toNativeSupport(CANDIDATE_FAMILIES[CANDIDATE_FAMILIES.length - 1]!)
}

export function buildMihonNativeFamilySummary(items: MihonSourceRecord[]): MihonNativeFamilySummary[] {
  const summary = new Map<string, MihonNativeFamilySummary>()

  for (const item of items) {
    const support = item.nativeSupport ?? resolveMihonNativeSupport(item)
    const current = summary.get(support.adapterId)

    if (current) {
      current.count += 1
      continue
    }

    summary.set(support.adapterId, {
      adapterId: support.adapterId,
      adapterName: support.adapterName,
      status: support.status,
      count: 1,
      canOpenNatively: support.canOpenNatively,
    })
  }

  return [...summary.values()].sort((left, right) => {
    const nativeDiff = Number(right.canOpenNatively) - Number(left.canOpenNatively)
    if (nativeDiff !== 0) {
      return nativeDiff
    }

    return right.count - left.count || left.adapterName.localeCompare(right.adapterName, 'es', { sensitivity: 'base' })
  })
}

