import { Role } from '@generated/client'
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

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { getClientInfo } from '@/shared/http/utils/client-info'
import { RequestContext } from '@/shared/tenancy/request-context'

import { AuthService } from '../auth.service'

import { HandoffService } from './handoff.service'

const SID_COOKIE = process.env.SESSION_COOKIE_NAME ?? 'sid'
const CSRF_COOKIE = process.env.CSRF_COOKIE_NAME ?? 'csrf'
const SAME_SITE = (process.env.COOKIE_SAMESITE ?? 'lax') as 'strict' | 'lax'
const isProd = process.env.NODE_ENV === 'production'

function sanitizeNext(next?: string): string {
	if (!next) return '/admin'
	if (!next.startsWith('/')) return '/admin'
	if (next.startsWith('//')) return '/admin'
	if (next.includes('http://') || next.includes('https://')) return '/admin'
	return next
}

@ApiTags('Auth')
@Controller('/auth')
export class HandoffController {
	constructor(
		private readonly handoff: HandoffService,
		private readonly auth: AuthService,
		private readonly prisma: PrismaService
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
	@ApiUnauthorizedResponse({ description: '����� �������������� ��� ����' })
	@ApiForbiddenResponse({ description: '����� �� ��� ����� ��������' })
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

		// если не ADMIN — перепроверяем владение каталогом
		if (payload.role !== Role.ADMIN) {
			const ownerId =
				store.ownerUserId ??
				(
					await this.prisma.catalog.findUnique({
						where: { id: store.catalogId },
						select: { userId: true }
					})
				)?.userId

			if (!ownerId || ownerId !== payload.userId) {
				throw new ForbiddenException('Нет прав на вход в этот каталог')
			}
		}

		const { ip, userAgent } = getClientInfo(req)
		const { sid, csrf } = await this.auth.createSessionForUser(
			payload.userId,
			{ ip, userAgent },
			store.catalogId
		)

		res.setHeader('Cache-Control', 'no-store')

		res.cookie(SID_COOKIE, sid, {
			httpOnly: true,
			sameSite: SAME_SITE,
			secure: isProd,
			path: '/',
			maxAge: 1000 * 60 * 60 * 24 * 7
		})

		res.cookie(CSRF_COOKIE, csrf, {
			httpOnly: false,
			sameSite: SAME_SITE,
			secure: isProd,
			path: '/',
			maxAge: 1000 * 60 * 60 * 24 * 7
		})

		return res.redirect(302, sanitizeNext(next ?? payload.next))
	}
}

