import {
	Controller,
	ForbiddenException,
	Get,
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

import { getClientInfo } from '@/shared/http/utils/client-info'
import { RequestContext } from '@/shared/tenancy/request-context'

import { setSessionCookies } from '../auth-cookie.utils'
import { AuthService } from '../auth.service'

import { HandoffService } from './handoff.service'
import { resolveHandoffNext } from './handoff.utils'

@ApiTags('Auth')
@Controller('/auth')
export class HandoffController {
	constructor(
		private readonly handoff: HandoffService,
		private readonly auth: AuthService
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
		if (!store.catalogId) throw new ForbiddenException('Нет контекста каталога')

		const payload = await this.handoff.consume(token)
		if (!payload)
			throw new UnauthorizedException('Токен недействителен или истёк')

		if (payload.catalogId !== store.catalogId) {
			throw new ForbiddenException('Токен не для этого каталога')
		}

		await this.auth.assertCatalogAccess(
			payload.userId,
			payload.role,
			store.catalogId,
			store.ownerUserId ?? null
		)

		const { ip, userAgent } = getClientInfo(req)
		const { sid, csrf } = await this.auth.createSessionForUser(
			payload.userId,
			{ ip, userAgent },
			store.catalogId
		)

		res.setHeader('Cache-Control', 'no-store')
		setSessionCookies(res, { sid, csrf })

		return res.redirect(302, resolveHandoffNext(next ?? payload.next))
	}
}
