import { Role } from '@generated/enums'
import {
	Body,
	Controller,
	Get,
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

import { ObservabilityService } from '@/modules/observability/observability.service'
import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'
import { getClientInfo } from '@/shared/http/utils/client-info'
import { SkipCatalog } from '@/shared/tenancy/decorators/skip-catalog.decorator'
import { RequestContext } from '@/shared/tenancy/request-context'
import { AuthThrottle } from '@/shared/throttler/auth-throttle.decorator'

import {
	clearSessionCookies,
	getSessionCookie,
	resolveCookieDomain,
	setSessionCookies
} from './auth-cookie.utils'
import { AuthService } from './auth.service'
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
		private readonly observability: ObservabilityService
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
		const { sid, csrf, user, catalogId } = await this.auth.login(
			dto,
			{ ip, userAgent },
			existingSid
		)

		res.setHeader('Cache-Control', 'no-store')
		setSessionCookies(
			res,
			{ sid, csrf },
			resolveCookieDomain(RequestContext.get()?.host ?? ''),
			catalogId ? { catalogId } : null
		)

		return { ok: true, user, catalogId }
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
		return { ok: true, user: (req as AuthRequest).user }
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
			resolveCookieDomain(RequestContext.get()?.host ?? ''),
			authReq.session?.context?.catalogId
				? { catalogId: authReq.session.context.catalogId }
				: null
		)

		return { ok: true }
	}
}
