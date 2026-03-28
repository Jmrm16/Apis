export interface MihonRepoSource {
  name: string
  lang: string
  id: string
  baseUrl: string
}

export interface MihonRepoExtension {
  name: string
  pkg: string
  apk: string
  lang: string
  code: number
  version: string
  nsfw: number
  sources: MihonRepoSource[]
}

export type MihonNsfwFilter = 'safe' | 'nsfw' | 'all'
export type MihonSiteType = 'remote' | 'local' | 'configurable'
export type MihonCatalogOrigin = 'official' | 'imported'
export type MihonNativeSupportStatus = 'integrated' | 'candidate' | 'blocked'
export type MihonNativeSupportConfidence = 'high' | 'medium' | 'low'

export interface MihonCatalogFilters {
  query?: string
  lang?: string | null
  nsfw?: MihonNsfwFilter
  page?: number
  limit?: number
  refresh?: boolean
}

export interface MihonNativeSupport {
  status: MihonNativeSupportStatus
  adapterId: string
  adapterName: string
  confidence: MihonNativeSupportConfidence
  canOpenNatively: boolean
  appSource: 'olympus' | 'manhwaweb' | 'mangadex' | 'namicomi' | null
  reason: string
}

export interface MihonNativeFamilySummary {
  adapterId: string
  adapterName: string
  status: MihonNativeSupportStatus
  count: number
  canOpenNatively: boolean
}

export interface MihonSourceRecord {
  key: string
  sourceName: string
  sourceLang: string
  sourceId: string
  baseUrl: string | null
  baseUrls: string[]
  host: string | null
  isNsfw: boolean
  extensionName: string
  extensionPackage: string
  extensionApk: string
  extensionVersion: string
  extensionLang: string
  extensionCode: number
  siteType: MihonSiteType
  catalogId: string
  catalogName: string
  catalogOrigin: MihonCatalogOrigin
  nativeSupport: MihonNativeSupport
}

export interface MihonLanguageStat {
  code: string
  count: number
}

export interface MihonCatalogStats {
  totalExtensions: number
  totalSources: number
  safeSources: number
  nsfwSources: number
  officialSources: number
  importedSources: number
  importedCatalogs: number
  languages: MihonLanguageStat[]
}

export interface MihonCatalogPage {
  repoUrl: string
  fetchedAt: string
  query: string
  lang: string | null
  nsfw: MihonNsfwFilter
  page: number
  limit: number
  totalItems: number
  totalPages: number
  filteredCount: number
  stats: MihonCatalogStats
  nativeFamilies: MihonNativeFamilySummary[]
  items: MihonSourceRecord[]
}

export interface MihonImportedCatalogRecord {
  id: string
  name: string
  repoUrl: string | null
  importedAt: string
  extensionCount: number
  sourceCount: number
}

export interface MihonImportedCatalogListResponse {
  items: MihonImportedCatalogRecord[]
}

export interface MihonImportCatalogInput {
  name?: string
  repoUrl?: string
  jsonText?: string
}

export interface MihonImportCatalogResult {
  catalog: MihonImportedCatalogRecord
}
