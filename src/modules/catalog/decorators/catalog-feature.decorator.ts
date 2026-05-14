import { SetMetadata } from '@nestjs/common'

export const CATALOG_FEATURE_KEY = 'catalog_feature'

export const CatalogFeature = (feature: string) =>
	SetMetadata(CATALOG_FEATURE_KEY, feature)
