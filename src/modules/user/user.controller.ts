import { Body, Controller, Post, Req, Res } from '@nestjs/common'
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'

import {
	resolveCookieDomain,
	setSessionCookies
} from '@/modules/auth/auth-cookie.utils'
import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'
import { getClientInfo } from '@/shared/http/utils/client-info'
import { SkipCatalog } from '@/shared/tenancy/decorators/skip-catalog.decorator'
import { RequestContext } from '@/shared/tenancy/request-context'

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

		setSessionCookies(
			res,
			{ sid, csrf },
			resolveCookieDomain(RequestContext.get()?.host ?? '')
		)
		return res.send({ ok: true })
	}
}
