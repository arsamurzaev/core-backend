import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
	IsEmail,
	IsNotEmpty,
	IsString,
	Matches,
	MaxLength,
	MinLength
} from 'class-validator'

import {
	SYSTEM_DOMAIN_SLUG_MAX_LENGTH,
	SYSTEM_DOMAIN_SLUG_MIN_LENGTH,
	SYSTEM_DOMAIN_SLUG_PATTERN
} from './check-system-domain.dto.req'

export class CatalogOnboardingSignupDtoReq {
	@ApiProperty({ type: String, example: 'Иван Иванов' })
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' ? value.trim() : value
	)
	@IsString()
	@IsNotEmpty()
	@MinLength(2)
	@MaxLength(255)
	fullName: string

	@ApiProperty({ type: String, example: '+79990000000' })
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' ? value.trim() : value
	)
	@IsString()
	@IsNotEmpty()
	@MinLength(5)
	@MaxLength(64)
	phone: string

	@ApiProperty({ type: String, example: 'owner@example.com' })
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' ? value.trim().toLowerCase() : value
	)
	@IsEmail()
	@MaxLength(320)
	email: string

	@ApiProperty({ type: String, example: 'Flowers shop' })
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' ? value.trim() : value
	)
	@IsString()
	@IsNotEmpty()
	@MinLength(2)
	@MaxLength(255)
	catalogName: string

	@ApiProperty({ type: String, example: 'flowers' })
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' ? value.trim().toLowerCase() : value
	)
	@IsString()
	@IsNotEmpty()
	@Matches(SYSTEM_DOMAIN_SLUG_PATTERN)
	@MinLength(SYSTEM_DOMAIN_SLUG_MIN_LENGTH)
	@MaxLength(SYSTEM_DOMAIN_SLUG_MAX_LENGTH)
	slug: string

	@ApiProperty({ type: String, example: 'type uuid' })
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' ? value.trim() : value
	)
	@IsString()
	@IsNotEmpty()
	typeId: string
}
