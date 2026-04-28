import { Role } from '@generated/client'
import {
	Controller,
	Get,
	Logger,
	Param,
	ParseUUIDPipe,
	Query,
	Res,
	UseGuards
} from '@nestjs/common'
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
import { ObservabilityService } from '@/modules/observability/observability.service'
import { getClientInfo } from '@/shared/http/utils/client-info'
import { SkipCatalog } from '@/shared/tenancy/decorators/skip-catalog.decorator'

import { Roles } from '../auth/decorators/roles.decorator'
import { SessionGuard } from '../auth/guards/session.guard'
import { HandoffService } from '../auth/handoff/handoff.service'
import type { AuthRequest } from '../auth/types/auth-request'

@ApiTags('Admin')
@ApiSecurity('csrf')
@SkipCatalog()
@UseGuards(SessionGuard)
@Controller('/admin/sso')
export class AdminSsoController {
	private readonly logger = new Logger(AdminSsoController.name)

	constructor(
		private readonly prisma: PrismaService,
		private readonly handoff: HandoffService,
		private readonly observability: ObservabilityService
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
		@Param('catalogId', ParseUUIDPipe) catalogId: string,
		@Query('next') next: string | undefined,
		@Res() res: Response
	) {
		const req = res.req as AuthRequest
		const currentUser = req.user as { id: string; role: Role } | undefined
		const { ip, userAgent } = getClientInfo(req)

		if (!currentUser) {
			this.recordFailure('session', catalogId, ip, userAgent, null)
			return res.status(401).send('Пользователь не найден')
		}

		const catalog = await this.prisma.catalog.findFirst({
			where: { id: catalogId, deleteAt: null },
			select: { slug: true, domain: true }
		})
		if (!catalog) {
			this.recordFailure('not_found', catalogId, ip, userAgent, currentUser.id)
			return res.status(404).send('Каталог не найден')
		}

		const token = await this.handoff.createForCatalog({
			userId: currentUser.id,
			role: currentUser.role,
			catalogId,
			next
		})

		this.observability.recordAuthEvent(
			'admin_sso',
			'handoff_issue',
			'success',
			'none'
		)
		this.logger.log({
			event: 'auth_event',
			flow: 'admin_sso',
			action: 'handoff_issue',
			outcome: 'success',
			reason: 'none',
			userId: currentUser.id,
			role: currentUser.role,
			catalogId,
			clientIp: ip || null,
			userAgent
		} as any)

		const host = catalog.domain?.trim()
			? catalog.domain.trim()
			: `${catalog.slug}.myctlg.ru`
		const url =
			`https://${host}/auth/handoff?token=${encodeURIComponent(token)}` +
			(next ? `&next=${encodeURIComponent(next)}` : '')

		return res.redirect(302, url)
	}

	private recordFailure(
		reason: 'session' | 'not_found',
		catalogId: string,
		ip: string,
		userAgent: string | null,
		userId: string | null
	) {
		this.observability.recordAuthEvent(
			'admin_sso',
			'handoff_issue',
			'failure',
			reason
		)
		this.logger.warn({
			event: 'auth_event',
			flow: 'admin_sso',
			action: 'handoff_issue',
			outcome: 'failure',
			reason,
			userId,
			catalogId,
			clientIp: ip || null,
			userAgent
		} as any)
	}
}
