import { Body, Controller, Post, Res } from '@nestjs/common'
import { ApiOperation } from '@nestjs/swagger'
import { type Response } from 'express'

import { SkipCatalog } from '@/shared/tenancy/decorators/skip-catalog.decorator'

import { CreateUserDtoReq } from './dto/requests/create-user.dto.req'
import { UserService } from './user.service'

@SkipCatalog()
@Controller('user')
export class UserController {
	constructor(private readonly userService: UserService) {}

	@Post('register')
	@ApiOperation({ summary: 'Регистрация пользователя' })
	async register(@Body() dto: CreateUserDtoReq, @Res() res: Response) {
		const { sid, csrf } = await this.userService.register(dto)

		const isProd = process.env.NODE_ENV === 'production'
		const sameSite = (process.env.COOKIE_SAMESITE ?? 'lax') as 'lax' | 'strict'

		return res.cookie(process.env.SESSION_COOKIE_NAME ?? 'sid', sid, {
			httpOnly: true,
			sameSite,
			secure: isProd,
			path: '/',
			maxAge: 1000 * 60 * 60 * 24 * 7
		}).cookie(process.env.CSRF_COOKIE_NAME ?? 'csrf', csrf, {
			httpOnly: false, // ВАЖНО: csrf должен быть доступен JS
			sameSite,
			secure: isProd,
			path: '/',
			maxAge: 1000 * 60 * 60 * 24 * 7
		}).send({ ok: true })

	}
}
