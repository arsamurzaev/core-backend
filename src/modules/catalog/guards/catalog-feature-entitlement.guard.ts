import {
	CanActivate,
	ExecutionContext,
	ForbiddenException,
	Injectable
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { RequestContext } from '@/shared/tenancy/request-context'

import { CatalogFeatureEntitlementService } from '../catalog-feature-entitlement.service'
import { CATALOG_FEATURE_KEY } from '../decorators/catalog-feature.decorator'

@Injectable()
export class CatalogFeatureEntitlementGuard implements CanActivate {
	constructor(
		private readonly reflector: Reflector,
		private readonly entitlements: CatalogFeatureEntitlementService
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const feature = this.reflector.getAllAndOverride<string>(
			CATALOG_FEATURE_KEY,
			[context.getHandler(), context.getClass()]
		)
		if (!feature) return true

		const catalogId = RequestContext.get()?.catalogId
		if (!catalogId) {
			throw new ForbiddenException('Catalog context is required')
		}

		if (!(await this.entitlements.canUse(catalogId, feature))) {
			throw new ForbiddenException('Feature is not enabled for this catalog')
		}

		return true
	}
}
