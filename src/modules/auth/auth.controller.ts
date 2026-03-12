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

import {
	clearSessionCookies,
	getSessionCookie,
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
	constructor(
		private readonly sessions: SessionService,
		private readonly auth: AuthService
	) {}

	@Post('/login')
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
		const { sid, csrf, user } = await this.auth.login(
			dto,
			{ ip, userAgent },
			existingSid
		)

		res.setHeader('Cache-Control', 'no-store')
		setSessionCookies(res, { sid, csrf })

		return { ok: true, user }
	}

	@UseGuards(SessionGuard)
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
	@Post('/logout')
	@ApiOperation({ summary: 'Logout' })
	@ApiSecurity('csrf')
	@ApiOkResponse({ description: 'Сессия очищена', type: OkResponseDto })
	@ApiUnauthorizedResponse({ description: 'Не авторизован' })
	async logout(@Res({ passthrough: true }) res: Response) {
		const sid = (res.req as AuthRequest).sessionId
		if (sid) await this.sessions.destroy(sid)

		res.setHeader('Cache-Control', 'no-store')
		clearSessionCookies(res)

		return { ok: true }
	}
}
