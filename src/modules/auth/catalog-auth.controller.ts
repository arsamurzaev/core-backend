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

import { AuthService } from './auth.service'
import { LoginDtoReq } from './dto/requests/login.dto.req'
import { AuthCatalogLoginResponseDto } from './dto/responses/auth-catalog-login.dto.res'

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
		const existingSid = getCookie(req, SID_COOKIE) ?? null
		const { sid, csrf, user, catalogId } = await this.auth.loginForCatalog(
			dto,
			store.catalogId,
			store.ownerUserId ?? null,
			{ ip, userAgent },
			existingSid
		)

		res.setHeader('Cache-Control', 'no-store')
		setSessionCookies(res, sid, csrf)

		return { ok: true, user, catalogId }
	}
}
