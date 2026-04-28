import { Role } from '@generated/enums'
import {
	Controller,
	ForbiddenException,
	Get,
	Logger,
	Query,
	Req,
	Res,
	UnauthorizedException
} from '@nestjs/common'
import {
	ApiForbiddenResponse,
	ApiFoundResponse,
	ApiOperation,
	ApiQuery,
	ApiTags,
	ApiUnauthorizedResponse
} from '@nestjs/swagger'
import type { Request, Response } from 'express'

import { ObservabilityService } from '@/modules/observability/observability.service'
import { getClientInfo } from '@/shared/http/utils/client-info'
import { RequestContext } from '@/shared/tenancy/request-context'

import { resolveCookieDomain, setSessionCookies } from '../auth-cookie.utils'
import { AuthService } from '../auth.service'

import { HandoffService } from './handoff.service'
import { resolveHandoffNext } from './handoff.utils'

@ApiTags('Auth')
@Controller('/auth')
export class HandoffController {
	private readonly logger = new Logger(HandoffController.name)

	constructor(
		private readonly handoff: HandoffService,
		private readonly auth: AuthService,
		private readonly observability: ObservabilityService
	) {}

	@Get('/handoff')
	@ApiOperation({ summary: 'Exchange handoff token and redirect' })
	@ApiQuery({
		name: 'token',
		required: true,
		description: 'Handoff-токен'
	})
	@ApiQuery({
		name: 'next',
		required: false,
		description: 'Переопределение пути редиректа'
	})
	@ApiFoundResponse({
		description: 'Редирект на целевой путь и установка cookies сессии'
	})
	@ApiUnauthorizedResponse({ description: 'Токен недействителен или истёк' })
	@ApiForbiddenResponse({ description: 'Токен не для этого каталога' })
	async exchange(
		@Query('token') token: string,
		@Query('next') next: string | undefined,
		@Req() req: Request,
		@Res() res: Response
	) {
		const store = RequestContext.mustGet()
		const { ip, userAgent } = getClientInfo(req)

		if (!store.catalogId) {
			this.recordFailure('other', ip, userAgent, null)
			throw new ForbiddenException('Нет контекста каталога')
		}

		const payload = await this.handoff.consume(token)
		if (!payload) {
			this.recordFailure('token', ip, userAgent, store.catalogId)
			throw new UnauthorizedException('Токен недействителен или истёк')
		}

		if (payload.catalogId !== store.catalogId) {
			this.recordFailure('access', ip, userAgent, store.catalogId)
			throw new ForbiddenException('Токен не для этого каталога')
		}

		try {
			await this.auth.assertCatalogAccess(
				payload.userId,
				payload.role,
				store.catalogId,
				store.ownerUserId ?? null
			)
		} catch (error) {
			this.recordFailure('access', ip, userAgent, store.catalogId)
			throw error
		}

		const { sid, csrf } = await this.auth.createSessionForUser(
			payload.userId,
			{ ip, userAgent },
			payload.role === Role.ADMIN ? null : store.catalogId
		)

		this.observability.recordAuthEvent(
			'catalog',
			'handoff_exchange',
			'success',
			'none'
		)
		this.logger.log({
			event: 'auth_event',
			flow: 'catalog',
			action: 'handoff_exchange',
			outcome: 'success',
			reason: 'none',
			userId: payload.userId,
			role: payload.role,
			catalogId: store.catalogId,
			clientIp: ip || null,
			userAgent
		} as any)

		res.setHeader('Cache-Control', 'no-store')
		setSessionCookies(
			res,
			{ sid, csrf },
			resolveCookieDomain(RequestContext.get()?.host ?? ''),
			payload.role === Role.ADMIN ? null : { catalogId: store.catalogId }
		)

		return res.redirect(302, resolveHandoffNext(next ?? payload.next))
	}

	private recordFailure(
		reason: 'access' | 'token' | 'other',
		ip: string,
		userAgent: string | null,
		catalogId: string | null
	) {
		this.observability.recordAuthEvent(
			'catalog',
			'handoff_exchange',
			'failure',
			reason
		)
		this.logger.warn({
			event: 'auth_event',
			flow: 'catalog',
			action: 'handoff_exchange',
			outcome: 'failure',
			reason,
			catalogId,
			clientIp: ip || null,
			userAgent
		} as any)
	}
}
