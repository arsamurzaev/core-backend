import { ApiProperty } from '@nestjs/swagger'

import { AuthUserDto } from '@/modules/auth/public'

export class SystemDomainAvailabilityDto {
	@ApiProperty({ type: Boolean })
	ok: boolean

	@ApiProperty({ type: String })
	slug: string

	@ApiProperty({ type: String })
	fqdn: string

	@ApiProperty({ type: Boolean })
	available: boolean

	@ApiProperty({ type: String, nullable: true })
	reason: string | null
}

export class CatalogOnboardingSignupResponseDto {
	@ApiProperty({ type: Boolean })
	ok: boolean

	@ApiProperty({ type: String })
	email: string

	@ApiProperty({ type: String })
	slug: string

	@ApiProperty({ type: String })
	fqdn: string

	@ApiProperty({ type: String, format: 'date-time' })
	expiresAt: string
}

export class CatalogOnboardingConfirmResponseDto {
	@ApiProperty({ type: Boolean })
	ok: boolean

	@ApiProperty({ type: AuthUserDto })
	user: AuthUserDto

	@ApiProperty({ type: String })
	catalogId: string

	@ApiProperty({ type: String })
	catalogUrl: string

	@ApiProperty({ type: String })
	loginUrl: string

	@ApiProperty({ type: Boolean })
	accessEmailSent: boolean

	@ApiProperty({
		type: String,
		example:
			'Аккаунт успешно подтвержден. Данные для доступа отправлены на почту.'
	})
	message: string
}
