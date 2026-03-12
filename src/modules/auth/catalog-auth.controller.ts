import {
	Body,
	Controller,
	NotFoundException,
	Post,
	Req,
	Res
} from '@nestjs/common'
import {
	ApiForbiddenResponse,
	ApiNotFoundResponse,
	ApiOkResponse,
	ApiOperation,
	ApiTags,
	ApiUnauthorizedResponse
} from '@nestjs/swagger'
import type { Request, Response } from 'express'

import { getClientInfo } from '@/shared/http/utils/client-info'
import { RequestContext } from '@/shared/tenancy/request-context'

import { getSessionCookie, setSessionCookies } from './auth-cookie.utils'
import { AuthService } from './auth.service'
import { LoginDtoReq } from './dto/requests/login.dto.req'
import { AuthCatalogLoginResponseDto } from './dto/responses/auth-catalog-login.dto.res'

@ApiTags('Catalog Auth')
@Controller('catalog/auth')
export class CatalogAuthController {
	constructor(private readonly auth: AuthService) {}

	@Post('login')
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
		const existingSid = getSessionCookie(req)
		const { sid, csrf, user, catalogId } = await this.auth.loginForCatalog(
			dto,
			store.catalogId,
			store.ownerUserId ?? null,
			{ ip, userAgent },
			existingSid
		)

		res.setHeader('Cache-Control', 'no-store')
		setSessionCookies(res, { sid, csrf })

		return { ok: true, user, catalogId }
	}
}
