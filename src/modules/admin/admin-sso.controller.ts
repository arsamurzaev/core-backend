import { Role } from '@generated/client'
import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common'
import {
	ApiForbiddenResponse,
	ApiFoundResponse,
	ApiNotFoundResponse,
	ApiOperation,
	ApiParam,
	ApiQuery,
	ApiSecurity,
	ApiTags,
	ApiUnauthorizedResponse
} from '@nestjs/swagger'
import type { Response } from 'express'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

import { Roles } from '../auth/decorators/roles.decorator'
import { SessionGuard } from '../auth/guards/session.guard'
import { HandoffService } from '../auth/handoff/handoff.service'

// Тут поставь guard админ-панели, который уже делает req.user
@ApiTags('Admin')
@ApiSecurity('csrf')
@UseGuards(SessionGuard)
@Controller('/admin/sso')
export class AdminSsoController {
	constructor(
		private readonly prisma: PrismaService,
		private readonly handoff: HandoffService
	) {}

	@ApiOperation({
		summary: 'Переброс на SSO',
		description: 'Перекидывает на страницу каталога в SSO'
	})
	@Roles(Role.ADMIN)
	@Get('/catalog/:catalogId')
	@ApiParam({
		name: 'catalogId',
		description: 'ID каталога'
	})
	@ApiQuery({
		name: 'next',
		required: false,
		description: 'Путь для редиректа после SSO'
	})
	@ApiFoundResponse({ description: 'Редирект на URL SSO' })
	@ApiNotFoundResponse({ description: 'Каталог не найден' })
	@ApiUnauthorizedResponse({ description: 'Не авторизован' })
	@ApiForbiddenResponse({ description: 'Недостаточно прав' })
	async enter(
		@Param('catalogId') catalogId: string,
		@Query('next') next: string | undefined,
		@Res() res: Response
	) {
		const currentUser = (res.req as any).user as { id: string; role: Role }

		const token = await this.handoff.createForCatalog({
			userId: currentUser.id,
			role: currentUser.role,
			catalogId,
			next
		})

		const catalog = await this.prisma.catalog.findUnique({
			where: { id: catalogId },
			select: { slug: true, domain: true }
		})
		if (!catalog) return res.status(404).send('Каталог не найден')

		const host = catalog.domain?.trim()
			? catalog.domain.trim()
			: `${catalog.slug}.myctlg.ru`
		const url =
			`https://${host}/auth/handoff?token=${encodeURIComponent(token)}` +
			(next ? `&next=${encodeURIComponent(next)}` : '')

		return res.redirect(302, url)
	}
}
