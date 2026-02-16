import { Role } from '@generated/enums'
// у тебя так
import {
	CanActivate,
	ExecutionContext,
	ForbiddenException,
	Injectable
} from '@nestjs/common'

import { RequestContext } from '@/shared/tenancy/request-context'

@Injectable()
export class CatalogAccessGuard implements CanActivate {
	canActivate(ctx: ExecutionContext): boolean {
		const req = ctx.switchToHttp().getRequest()
		const user = req.user as { id: string; role: Role } | undefined
		if (!user) throw new ForbiddenException('Нет пользователя в запросе')

		const store = RequestContext.get()
		const catalogId = store?.catalogId
		if (!catalogId) throw new ForbiddenException('Нет контекста каталога')

		// ADMIN — может всё
		if (user.role === Role.ADMIN) return true

		// Владелец — только свой каталог
		if (user.role === Role.CATALOG) {
			if (store?.ownerUserId && store.ownerUserId === user.id) return true
			throw new ForbiddenException('Владелец: нет доступа к этому каталогу')
		}

		throw new ForbiddenException('Нет доступа к каталогу')
	}
}
