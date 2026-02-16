import { Body, Controller, Post, Req, Res } from '@nestjs/common'
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'

import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'
import { getClientInfo } from '@/shared/http/utils/client-info'
import { SkipCatalog } from '@/shared/tenancy/decorators/skip-catalog.decorator'

import { CreateUserDtoReq } from './dto/requests/create-user.dto.req'
import { UserService } from './user.service'

@ApiTags('User')
@SkipCatalog()
@Controller('user')
export class UserController {
	constructor(private readonly userService: UserService) {}

	@Post('register')
	@ApiCreatedResponse({
		description: 'Пользователь зарегистрирован, cookies установлены',
		type: OkResponseDto
	})
	@ApiOperation({ summary: 'Регистрация пользователя' })
	async register(
		@Body() dto: CreateUserDtoReq,
		@Req() req: Request,
		@Res() res: Response
	) {
		const { ip, userAgent } = getClientInfo(req)
		const { sid, csrf } = await this.userService.register(dto, { ip, userAgent })

		const isProd = process.env.NODE_ENV === 'production'
		const sameSite = (process.env.COOKIE_SAMESITE ?? 'lax') as 'lax' | 'strict'

		return res
			.cookie(process.env.SESSION_COOKIE_NAME ?? 'sid', sid, {
				httpOnly: true,
				sameSite,
				secure: isProd,
				path: '/',
				maxAge: 1000 * 60 * 60 * 24 * 7
			})
			.cookie(process.env.CSRF_COOKIE_NAME ?? 'csrf', csrf, {
				httpOnly: false, // ВАЖНО: csrf должен быть доступен JS
				sameSite,
				secure: isProd,
				path: '/',
				maxAge: 1000 * 60 * 60 * 24 * 7
			})
			.send({ ok: true })
	}
}
