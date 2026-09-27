export const CATALOG_KINDS = ['music', 'youtube', 'instagram', 'pinterest', 'beauty', 'fashion', 'books', 'papers'] as const;
export type CatalogKind = typeof CATALOG_KINDS[number];
export const CATALOG_LABELS: Record<CatalogKind, string> = { music: 'Music', youtube: 'YouTube', instagram: 'Instagram', pinterest: 'Pinterest', beauty: 'Beauty', fashion: 'Fashion', books: 'Books', papers: 'Papers' };
export interface CatalogSource { id: string; label: string; homeUrl: string; kind: CatalogKind; status: 'collected' | 'partial' | 'blocked'; checkedAt: string; note: string }
export interface CatalogCollection { id: string; title: string; kind: CatalogKind; description: string }
export interface CatalogInputItem { sourceId: string; externalId?: string; kind: CatalogKind; collectionIds: string[]; title: string; url: string; creator?: string; description?: string; imageUrl?: string; observedAt: string; listingUrl: string; attributes: Record<string, string | number>; extraction: 'browser-dom' | 'official-api' }
export interface CatalogBatch { source: CatalogSource; collections: CatalogCollection[]; items: CatalogInputItem[] }
export interface CatalogItem extends CatalogInputItem { id: string; version: number; firstSeenAt: string; lastSeenAt: string }
export interface CatalogCollectionSummary extends CatalogCollection { count: number; previewImages: string[]; sourceIds: string[] }
export interface CatalogSummary { total: number; byKind: Partial<Record<CatalogKind, number>>; sources: (CatalogSource & { count: number })[]; collections: CatalogCollectionSummary[]; lastCollectedAt: string | null; database: 'SQLite'; runs: { id: string; sourceId: string; inserted: number; updated: number; unchanged: number; importedAt: string }[] }
export interface CatalogRankedItem extends CatalogItem { rank: number; sourceRank: number; score: number; modelVersion: number }
export interface CatalogPage { collection: CatalogCollectionSummary; items: CatalogRankedItem[]; total: number; offset: number; limit: number; modelVersion: number; trainingCount: number; rankingBasis: string }
