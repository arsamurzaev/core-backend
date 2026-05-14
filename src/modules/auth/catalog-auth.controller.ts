import { Role } from '@generated/enums'
import {
	BadRequestException,
	Body,
	Controller,
	Get,
	NotFoundException,
	Param,
	Post,
	Req,
	Res,
	UseGuards
} from '@nestjs/common'
import {
	ApiForbiddenResponse,
	ApiNotFoundResponse,
	ApiOkResponse,
	ApiOperation,
	ApiParam,
	ApiSecurity,
	ApiTags,
	ApiUnauthorizedResponse
} from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import type { Request, Response } from 'express'

import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'
import { getClientInfo } from '@/shared/http/utils/client-info'
import { RequestContext } from '@/shared/tenancy/request-context'
import { AuthThrottle } from '@/shared/throttler/auth-throttle.decorator'

import {
	getSessionCookie,
	resolveCookieDomain,
	resolveServerHost,
	setSessionCookies
} from './auth-cookie.utils'
import { AuthService } from './auth.service'
import { ChangePasswordDtoReq } from './dto/requests/change-password.dto.req'
import { LoginDtoReq } from './dto/requests/login.dto.req'
import { AuthCatalogLoginResponseDto } from './dto/responses/auth-catalog-login.dto.res'
import {
	AuthSessionDto,
	AuthSessionsResponseDto
} from './dto/responses/session.dto.res'
import { SessionGuard } from './guards/session.guard'
import {
	type ActiveSessionEntry,
	SessionService
} from './session/session.service'
import type { AuthRequest } from './types/auth-request'

@ApiTags('Catalog Auth')
@Controller('catalog/auth')
export class CatalogAuthController {
	constructor(
		private readonly auth: AuthService,
		private readonly sessions: SessionService
	) {}

	@Post('login')
	@AuthThrottle()
	@ApiOperation({ summary: 'Catalog login' })
	@ApiOkResponse({
		description: 'Аутентифицирован для каталога, cookies установлены',
		type: AuthCatalogLoginResponseDto
	})
	@ApiUnauthorizedResponse({ description: 'Неверные учётные данные' })
	@ApiForbiddenResponse({ description: 'Нет прав для этого каталога' })
	@ApiNotFoundResponse({ description: 'Каталог не найден' })
	async login(
		@Body() dto: LoginDtoReq,
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response
	) {
		const store = RequestContext.get()
		if (!store?.catalogId) {
			throw new NotFoundException('Каталог не найден')
		}

		const { ip, userAgent } = getClientInfo(req)
		const existingSid = getSessionCookie(req, { catalogId: store.catalogId })
		const { sid, csrf, user, catalogId } = await this.auth.loginForCatalog(
			dto,
			store.catalogId,
			store.ownerUserId ?? null,
			{ ip, userAgent },
			existingSid
		)

		res.setHeader('Cache-Control', 'no-store')
		setSessionCookies(
			res,
			{ sid, csrf },
			resolveCookieDomain(resolveServerHost(req)),
			user.role === Role.ADMIN ? { global: true } : null
		)

		return { ok: true, user, catalogId }
	}

	@UseGuards(SessionGuard)
	@SkipThrottle()
	@Post('change-password')
	@ApiOperation({ summary: 'Change current catalog user password' })
	@ApiSecurity('csrf')
	@ApiOkResponse({ description: 'Пароль изменён', type: OkResponseDto })
	@ApiUnauthorizedResponse({ description: 'Не авторизован или неверный пароль' })
	async changePassword(@Body() dto: ChangePasswordDtoReq, @Req() req: Request) {
		const authReq = req as AuthRequest
		await this.auth.changePassword(
			authReq.user.id,
			dto,
			authReq.sessionId ?? null
		)
		return { ok: true }
	}

	@UseGuards(SessionGuard)
	@SkipThrottle()
	@Get('sessions')
	@ApiOperation({ summary: 'List current catalog user sessions' })
	@ApiSecurity('csrf')
	@ApiOkResponse({
		description: 'Активные сессии текущего пользователя каталога',
		type: AuthSessionsResponseDto
	})
	@ApiUnauthorizedResponse({ description: 'Не авторизован' })
	async sessionsList(@Req() req: Request): Promise<AuthSessionsResponseDto> {
		const authReq = req as AuthRequest
		const entries = await this.sessions.listActiveForUser(authReq.user.id)

		return {
			ok: true,
			sessions: entries.map(entry =>
				this.mapSession(entry, authReq.sessionId ?? null)
			)
		}
	}

	@UseGuards(SessionGuard)
	@SkipThrottle()
	@Post('sessions/revoke-others')
	@ApiOperation({ summary: 'Revoke all other catalog user sessions' })
	@ApiSecurity('csrf')
	@ApiOkResponse({
		description: 'Остальные сессии сброшены',
		type: OkResponseDto
	})
	@ApiUnauthorizedResponse({ description: 'Не авторизован' })
	async revokeOtherSessions(@Req() req: Request) {
		const authReq = req as AuthRequest
		await this.sessions.destroyAllForUserExcept(
			authReq.user.id,
			authReq.sessionId ?? ''
		)
		return { ok: true }
	}

	@UseGuards(SessionGuard)
	@SkipThrottle()
	@Post('sessions/:sid/revoke')
	@ApiOperation({ summary: 'Revoke one catalog user session' })
	@ApiSecurity('csrf')
	@ApiParam({ name: 'sid', description: 'Session ID' })
	@ApiOkResponse({ description: 'Сессия сброшена', type: OkResponseDto })
	@ApiUnauthorizedResponse({ description: 'Не авторизован' })
	async revokeSession(@Param('sid') sid: string, @Req() req: Request) {
		const authReq = req as AuthRequest
		if (!sid || sid === authReq.sessionId) {
			throw new BadRequestException('Текущую сессию нельзя сбросить здесь')
		}

		await this.sessions.destroyForUser(authReq.user.id, sid)
		return { ok: true }
	}

	private mapSession(
		entry: ActiveSessionEntry,
		currentSid: string | null
	): AuthSessionDto {
		const userAgent = entry.client.userAgent

		return {
			id: entry.sid,
			isCurrent: entry.sid === currentSid,
			isPrimary: entry.isPrimary,
			createdAt: new Date(entry.createdAt).toISOString(),
			expiresAt: entry.expiresAt ? new Date(entry.expiresAt).toISOString() : null,
			ttlSeconds: entry.ttlSeconds,
			client: {
				ip: entry.client.ip,
				browser: userAgent?.browser ?? null,
				os: userAgent?.os ?? null,
				device: userAgent?.device ?? null,
				geo: entry.client.geo
					? {
							city: entry.client.geo.city,
							region: entry.client.geo.region
						}
					: null
			}
		}
	}
}
