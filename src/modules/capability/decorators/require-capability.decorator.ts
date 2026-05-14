import { SetMetadata } from '@nestjs/common'

import type { CatalogCapability } from '../capability.constants'

export const CAPABILITY_KEY = 'catalog_capability'

export const RequireCapability = (capability: CatalogCapability) =>
	SetMetadata(CAPABILITY_KEY, capability)
