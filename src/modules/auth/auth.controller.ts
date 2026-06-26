import { Role } from '@generated/enums'
import {
	Body,
	Controller,
	Get,
	Inject,
	Logger,
	Post,
	Req,
	Res,
	UseGuards
} from '@nestjs/common'
import {
	ApiOkResponse,
	ApiOperation,
	ApiSecurity,
	ApiTags,
	ApiUnauthorizedResponse
} from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import type { Request, Response } from 'express'

import {
	OBSERVABILITY_RECORDER_PORT,
	type ObservabilityRecorderPort
} from '@/modules/observability/contracts'
import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'
import { getClientInfo } from '@/shared/http/utils/client-info'
import { SkipCatalog } from '@/shared/tenancy/decorators/skip-catalog.decorator'
import { AuthThrottle } from '@/shared/throttler/auth-throttle.decorator'

import {
	clearSessionCookies,
	getSessionCookie,
	resolveCookieDomain,
	resolveServerHost,
	setSessionCookies
} from './auth-cookie.utils'
import { AuthService } from './auth.service'
import { ChangePasswordDtoReq } from './dto/requests/change-password.dto.req'
import { LoginDtoReq } from './dto/requests/login.dto.req'
import { AuthLoginResponseDto } from './dto/responses/auth-login.dto.res'
import { SessionGuard } from './guards/session.guard'
import { SessionService } from './session/session.service'
import type { AuthRequest } from './types/auth-request'

@ApiTags('Auth')
@SkipCatalog()
@Controller('/auth')
export class AuthController {
	private readonly logger = new Logger(AuthController.name)

	constructor(
		private readonly sessions: SessionService,
		private readonly auth: AuthService,
		@Inject(OBSERVABILITY_RECORDER_PORT)
		private readonly observability: ObservabilityRecorderPort
	) {}

	@Post('/login')
	@AuthThrottle()
	@ApiOperation({ summary: 'Login' })
	@ApiOkResponse({
		description: 'Аутентифицирован, cookies установлены',
		type: AuthLoginResponseDto
	})
	@ApiUnauthorizedResponse({ description: 'Неверные учётные данные' })
	async login(
		@Body() dto: LoginDtoReq,
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response
	) {
		const { ip, userAgent } = getClientInfo(req)
		const existingSid = getSessionCookie(req)
		const { sid, csrf, user, catalogId, redirectUrl } = await this.auth.login(
			dto,
			{ ip, userAgent },
			existingSid
		)

		res.setHeader('Cache-Control', 'no-store')
		setSessionCookies(
			res,
			{ sid, csrf },
			resolveCookieDomain(resolveServerHost(req)),
			user.role === Role.ADMIN || user.role === Role.GEO_ADMIN
				? { global: true }
				: null
		)

		return { ok: true, user, catalogId, csrf, redirectUrl }
	}

	@UseGuards(SessionGuard)
	@SkipThrottle()
	@Get('/me')
	@ApiOperation({ summary: 'Get current user' })
	@ApiOkResponse({
		description: 'Аутентифицированный пользователь',
		type: AuthLoginResponseDto
	})
	@ApiUnauthorizedResponse({ description: 'Не авторизован' })
	me(@Req() req: Request) {
		const authReq = req as AuthRequest
		return { ok: true, user: authReq.user, csrf: authReq.session?.csrf ?? null }
	}

	@UseGuards(SessionGuard)
	@SkipThrottle()
	@Post('/change-password')
	@ApiOperation({ summary: 'Change current user password' })
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
	@Post('/logout')
	@ApiOperation({ summary: 'Logout' })
	@ApiSecurity('csrf')
	@ApiOkResponse({ description: 'Сессия очищена', type: OkResponseDto })
	@ApiUnauthorizedResponse({ description: 'Не авторизован' })
	async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
		const authReq = req as AuthRequest
		const sid = authReq.sessionId
		const { ip, userAgent } = getClientInfo(req)
		const flow = authReq.user?.role === Role.CATALOG ? 'catalog' : 'session'

		if (sid) await this.sessions.destroy(sid)

		this.observability.recordAuthEvent(flow, 'logout', 'success', 'none')
		this.logger.log({
			event: 'auth_event',
			flow,
			action: 'logout',
			outcome: 'success',
			reason: 'none',
			userId: authReq.user?.id ?? null,
			role: authReq.user?.role ?? null,
			sessionId: sid ?? null,
			clientIp: ip || null,
			userAgent
		} as any)

		res.setHeader('Cache-Control', 'no-store')
		clearSessionCookies(
			res,
			resolveCookieDomain(resolveServerHost(req)),
			authReq.user?.role === Role.ADMIN || authReq.user?.role === Role.GEO_ADMIN
				? { global: true }
				: null
		)

		return { ok: true }
	}
}
