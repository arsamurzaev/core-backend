import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator'

const COUNTRY_CODE_PATTERN = /^[A-Z0-9-]+$/

function trimRequiredString(value: unknown) {
	if (typeof value !== 'string') return value
	return value.trim()
}

function trimOptionalUppercaseCode(value: unknown) {
	if (value === undefined || value === null) return undefined
	if (typeof value !== 'string') return value
	const normalized = value.trim().toUpperCase()
	return normalized.length ? normalized : undefined
}

export class AdminCreateCountryDtoReq {
	@ApiProperty({ type: String, example: 'Россия' })
	@Transform(({ value }: { value: unknown }) => trimRequiredString(value))
	@IsString()
	@IsNotEmpty()
	@MaxLength(100)
	name: string

	@ApiPropertyOptional({
		type: String,
		example: 'RU',
		description: 'If omitted, generated from name.'
	})
	@Transform(({ value }: { value: unknown }) =>
		trimOptionalUppercaseCode(value)
	)
	@IsOptional()
	@IsString()
	@Matches(COUNTRY_CODE_PATTERN)
	@MaxLength(8)
	code?: string
}
