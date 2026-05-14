import { TestingModuleBuilder } from '@nestjs/testing'

import { CatalogAccessGuard } from '@/modules/auth/guards/catalog-access.guard'
import { OptionalSessionGuard } from '@/modules/auth/guards/optional-session.guard'
import { SessionGuard } from '@/modules/auth/guards/session.guard'
import { CapabilityGuard } from '@/modules/capability/guards/capability.guard'
import { CatalogFeatureEntitlementGuard } from '@/modules/catalog/guards/catalog-feature-entitlement.guard'

const allowGuard = { canActivate: () => true }

export function overrideControllerAuthGuards(
	builder: TestingModuleBuilder
): TestingModuleBuilder {
	return builder
		.overrideGuard(SessionGuard)
		.useValue(allowGuard)
		.overrideGuard(OptionalSessionGuard)
		.useValue(allowGuard)
		.overrideGuard(CatalogAccessGuard)
		.useValue(allowGuard)
		.overrideGuard(CatalogFeatureEntitlementGuard)
		.useValue(allowGuard)
		.overrideGuard(CapabilityGuard)
		.useValue(allowGuard)
}
