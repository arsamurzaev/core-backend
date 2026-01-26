import {
    CanActivate,
    ExecutionContext,
    Injectable,
    InternalServerErrorException,
    NotFoundException
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { SKIP_CATALOG_KEY } from './decorators/skip-catalog.decorator'
import { RequestContext } from './request-context'

@Injectable()
export class CatalogGuard implements CanActivate {
	constructor(private readonly reflector: Reflector) {}

	canActivate(context: ExecutionContext): boolean {
		const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CATALOG_KEY, [
			context.getHandler(),
			context.getClass()
		])
		if (skip) {
			if (RequestContext.get()) {
				RequestContext.patch({ skipCatalog: true })
			}
			return true
		}

		const store = RequestContext.get()
		if (!store) {
			throw new InternalServerErrorException(
				'RequestContext not initialized (middleware not applied)'
			)
		}

		if (!store.catalogId) {
			throw new NotFoundException('Каталог не найден')
		}

		return true
	}
}
