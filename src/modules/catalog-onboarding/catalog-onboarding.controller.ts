import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common'
import {
	ApiCreatedResponse,
	ApiOkResponse,
	ApiOperation,
	ApiTags
} from '@nestjs/swagger'
import type { Request, Response } from 'express'

import {
	getSessionCookie,
	resolveCookieDomain,
	resolveServerHost,
	setSessionCookies
} from '@/modules/auth/public'
import { getClientInfo } from '@/shared/http/utils/client-info'
import { SkipCatalog } from '@/shared/tenancy/decorators/skip-catalog.decorator'
import { AuthThrottle } from '@/shared/throttler/auth-throttle.decorator'

import { CatalogOnboardingService } from './catalog-onboarding.service'
import { CatalogOnboardingConfirmDtoReq } from './dto/requests/catalog-onboarding-confirm.dto.req'
import { CatalogOnboardingResendDtoReq } from './dto/requests/catalog-onboarding-resend.dto.req'
import { CatalogOnboardingSignupDtoReq } from './dto/requests/catalog-onboarding-signup.dto.req'
import { CheckSystemDomainDtoReq } from './dto/requests/check-system-domain.dto.req'
import {
	CatalogOnboardingConfirmResponseDto,
	CatalogOnboardingSignupResponseDto,
	SystemDomainAvailabilityDto
} from './dto/responses/catalog-onboarding.dto.res'

@ApiTags('Catalog Onboarding')
@SkipCatalog()
@Controller('catalog-onboarding')
export class CatalogOnboardingController {
	constructor(private readonly onboarding: CatalogOnboardingService) {}

	@Get('system-domain/check')
	@ApiOperation({ summary: 'Check system catalog domain availability' })
	@ApiOkResponse({ type: SystemDomainAvailabilityDto })
	checkSystemDomain(
		@Query() dto: CheckSystemDomainDtoReq
	): Promise<SystemDomainAvailabilityDto> {
		return this.onboarding.checkSystemDomain(dto)
	}

	@Post('signup')
	@AuthThrottle()
	@ApiOperation({ summary: 'Start catalog signup and send verification email' })
	@ApiCreatedResponse({ type: CatalogOnboardingSignupResponseDto })
	signup(
		@Body() dto: CatalogOnboardingSignupDtoReq
	): Promise<CatalogOnboardingSignupResponseDto> {
		return this.onboarding.signup(dto)
	}

	@Post('resend')
	@AuthThrottle()
	@ApiOperation({ summary: 'Resend catalog signup verification email' })
	@ApiOkResponse({ type: CatalogOnboardingSignupResponseDto })
	resend(
		@Body() dto: CatalogOnboardingResendDtoReq
	): Promise<CatalogOnboardingSignupResponseDto> {
		return this.onboarding.resend(dto)
	}

	@Post('confirm')
	@AuthThrottle()
	@ApiOperation({ summary: 'Confirm catalog signup and create catalog' })
	@ApiOkResponse({ type: CatalogOnboardingConfirmResponseDto })
	async confirm(
		@Body() dto: CatalogOnboardingConfirmDtoReq,
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response
	): Promise<CatalogOnboardingConfirmResponseDto> {
		const { ip, userAgent } = getClientInfo(req)
		const existingSid = getSessionCookie(req)
		const result = await this.onboarding.confirm(
			dto,
			{ ip, userAgent },
			existingSid
		)

		res.setHeader('Cache-Control', 'no-store')
		setSessionCookies(
			res,
			{ sid: result.session.sid, csrf: result.session.csrf },
			resolveCookieDomain(resolveServerHost(req))
		)

		return {
			ok: true,
			user: result.user,
			catalogId: result.catalogId,
			catalogUrl: result.catalogUrl,
			loginUrl: result.loginUrl,
			accessEmailSent: result.accessEmailSent,
			message: result.message
		}
	}
}
