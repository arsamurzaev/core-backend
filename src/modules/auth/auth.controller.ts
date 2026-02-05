import {
	Body,
	Controller,
	Get,
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
import type { Request, Response } from 'express'

import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'
import { getClientInfo } from '@/shared/http/utils/client-info'
import { SkipCatalog } from '@/shared/tenancy/decorators/skip-catalog.decorator'

import { AuthService } from './auth.service'
import { LoginDtoReq } from './dto/requests/login.dto.req'
import { AuthLoginResponseDto } from './dto/responses/auth-login.dto.res'
import { SessionGuard } from './guards/session.guard'
import { SessionService } from './session/session.service'

const SID_COOKIE = process.env.SESSION_COOKIE_NAME ?? 'sid'
const CSRF_COOKIE = process.env.CSRF_COOKIE_NAME ?? 'csrf'
const SAME_SITE = (process.env.COOKIE_SAMESITE ?? 'lax') as 'strict' | 'lax'
const isProd = process.env.NODE_ENV === 'production'
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7

function getCookie(req: Request, name: string): string | undefined {
	const direct = (req as any).cookies?.[name]
	if (typeof direct === 'string' && direct) return direct

	const header = req.headers.cookie
	if (!header) return undefined
	for (const part of header.split(';')) {
		const [k, ...rest] = part.trim().split('=')
		if (k === name) return decodeURIComponent(rest.join('='))
	}
	return undefined
}

function setSessionCookies(res: Response, sid: string, csrf: string) {
	res.cookie(SID_COOKIE, sid, {
		httpOnly: true,
		sameSite: SAME_SITE,
		secure: isProd,
		path: '/',
		maxAge: SESSION_MAX_AGE_MS
	})
	res.cookie(CSRF_COOKIE, csrf, {
		httpOnly: false,
		sameSite: SAME_SITE,
		secure: isProd,
		path: '/',
		maxAge: SESSION_MAX_AGE_MS
	})
}

@ApiTags('Auth')
@SkipCatalog()
@Controller('/auth')
export class AuthController {
	constructor(
		private readonly sessions: SessionService,
		private readonly auth: AuthService
	) {}

	@Post('/login')
	@ApiOperation({ summary: 'Login' })
	@ApiOkResponse({
		description: 'Authenticated, cookies set',
		type: AuthLoginResponseDto
	})
	@ApiUnauthorizedResponse({ description: 'Invalid credentials' })
	async login(
		@Body() dto: LoginDtoReq,
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response
	) {
		const { ip, userAgent } = getClientInfo(req)
		const existingSid = getCookie(req, SID_COOKIE) ?? null
		const { sid, csrf, user } = await this.auth.login(
			dto,
			{ ip, userAgent },
			existingSid
		)

		res.setHeader('Cache-Control', 'no-store')
		setSessionCookies(res, sid, csrf)

		return { ok: true, user }
	}

	@UseGuards(SessionGuard)
	@Get('/me')
	@ApiOperation({ summary: 'Get current user' })
	@ApiOkResponse({
		description: 'Authenticated user',
		type: AuthLoginResponseDto
	})
	@ApiUnauthorizedResponse({ description: 'Not authenticated' })
	me(@Req() req: Request) {
		return { ok: true, user: (req as any).user }
	}

	@UseGuards(SessionGuard)
	@Post('/logout')
	@ApiOperation({ summary: 'Logout' })
	@ApiSecurity('csrf')
	@ApiOkResponse({ description: 'Session cleared', type: OkResponseDto })
	@ApiUnauthorizedResponse({ description: 'Not authenticated' })
	async logout(@Res({ passthrough: true }) res: Response) {
		const sid = (res.req as any).sessionId as string | undefined
		if (sid) await this.sessions.destroy(sid)

		res.setHeader('Cache-Control', 'no-store')

		// важно: параметры должны совпадать с установкой cookie (path, sameSite, secure)
		res.clearCookie(SID_COOKIE, {
			path: '/',
			sameSite: SAME_SITE,
			secure: isProd
		})
		res.clearCookie(CSRF_COOKIE, {
			path: '/',
			sameSite: SAME_SITE,
			secure: isProd
		})

		return { ok: true }
	}
}
