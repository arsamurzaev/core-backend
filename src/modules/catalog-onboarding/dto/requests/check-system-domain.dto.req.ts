import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
	IsNotEmpty,
	IsString,
	Matches,
	MaxLength,
	MinLength
} from 'class-validator'

export const SYSTEM_DOMAIN_SLUG_PATTERN = /^[a-z0-9-]+$/
export const SYSTEM_DOMAIN_SLUG_MIN_LENGTH = 2
export const SYSTEM_DOMAIN_SLUG_MAX_LENGTH = 63

export class CheckSystemDomainDtoReq {
	@ApiProperty({ type: String, example: 'flowers' })
	@Transform(({ value }: { value: unknown }) => {
		if (typeof value !== 'string') return value
		return value.trim().toLowerCase()
	})
	@IsString()
	@IsNotEmpty()
	@Matches(SYSTEM_DOMAIN_SLUG_PATTERN)
	@MinLength(SYSTEM_DOMAIN_SLUG_MIN_LENGTH)
	@MaxLength(SYSTEM_DOMAIN_SLUG_MAX_LENGTH)
	slug: string
}
