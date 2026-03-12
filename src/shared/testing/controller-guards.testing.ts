import { TestingModuleBuilder } from '@nestjs/testing'

import { CatalogAccessGuard } from '@/modules/auth/guards/catalog-access.guard'
import { SessionGuard } from '@/modules/auth/guards/session.guard'

const allowGuard = { canActivate: () => true }

export function overrideControllerAuthGuards(
	builder: TestingModuleBuilder
): TestingModuleBuilder {
	return builder
		.overrideGuard(SessionGuard)
		.useValue(allowGuard)
		.overrideGuard(CatalogAccessGuard)
		.useValue(allowGuard)
}
