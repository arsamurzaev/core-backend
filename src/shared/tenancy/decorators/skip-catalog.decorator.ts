import { SetMetadata } from '@nestjs/common'

export const SKIP_CATALOG_KEY = 'skipCatalog'

export const SkipCatalog = () => SetMetadata(SKIP_CATALOG_KEY, true)
