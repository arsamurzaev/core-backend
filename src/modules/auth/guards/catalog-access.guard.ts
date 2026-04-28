import { Role } from '@generated/enums'
// у тебя так
import {
	CanActivate,
	ExecutionContext,
	ForbiddenException,
	Injectable
} from '@nestjs/common'

import { RequestContext } from '@/shared/tenancy/request-context'

import type { AuthRequest } from '../types/auth-request'

@Injectable()
export class CatalogAccessGuard implements CanActivate {
	canActivate(ctx: ExecutionContext): boolean {
		const req = ctx.switchToHttp().getRequest<AuthRequest>()
		const user = req.user
		if (!user) throw new ForbiddenException('Нет пользователя в запросе')

		const store = RequestContext.get()
		const catalogId = store?.catalogId
		if (!catalogId) throw new ForbiddenException('Нет контекста каталога')

		// ADMIN — может всё
		if (user.role === Role.ADMIN) return true

		// Владелец — только свой каталог
		if (user.role === Role.CATALOG) {
			const sessionCatalogId = req.session?.context?.catalogId ?? null
			if (sessionCatalogId !== catalogId) {
				throw new ForbiddenException('Сессия не для этого каталога')
			}
			if (store?.ownerUserId && store.ownerUserId === user.id) return true
			throw new ForbiddenException('Владелец: нет доступа к этому каталогу')
		}

		throw new ForbiddenException('Нет доступа к каталогу')
	}
}
