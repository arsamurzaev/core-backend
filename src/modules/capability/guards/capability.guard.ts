import {
	CanActivate,
	ExecutionContext,
	ForbiddenException,
	Injectable
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { RequestContext } from '@/shared/tenancy/request-context'

import type { CatalogCapability } from '../capability.constants'
import { CapabilityService } from '../capability.service'
import { CAPABILITY_KEY } from '../decorators/require-capability.decorator'

@Injectable()
export class CapabilityGuard implements CanActivate {
	constructor(
		private readonly reflector: Reflector,
		private readonly capabilities: CapabilityService
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const capability = this.reflector.getAllAndOverride<CatalogCapability>(
			CAPABILITY_KEY,
			[context.getHandler(), context.getClass()]
		)
		if (!capability) return true

		const catalogId = RequestContext.get()?.catalogId
		if (!catalogId) {
			throw new ForbiddenException('Контекст каталога обязателен')
		}

		await this.capabilities.assert(catalogId, capability)
		return true
	}
}
