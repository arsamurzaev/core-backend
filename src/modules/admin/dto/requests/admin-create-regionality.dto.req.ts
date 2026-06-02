import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
	IsNotEmpty,
	IsOptional,
	IsString,
	IsUUID,
	Matches,
	MaxLength
} from 'class-validator'

const REGIONALITY_CODE_PATTERN = /^[A-Z0-9-]+$/

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

export class AdminCreateRegionalityDtoReq {
	@ApiPropertyOptional({
		type: String,
		format: 'uuid',
		description: 'Existing country id. If provided, countryName/countryCode are ignored.'
	})
	@IsOptional()
	@IsString()
	@IsUUID()
	countryId?: string

	@ApiPropertyOptional({
		type: String,
		format: 'uuid',
		nullable: true,
		description: 'Parent region id for nested regional directories.'
	})
	@IsOptional()
	@IsString()
	@IsUUID()
	parentId?: string | null

	@ApiPropertyOptional({
		type: String,
		example: 'Россия',
		description: 'Required when countryId is not provided.'
	})
	@Transform(({ value }: { value: unknown }) => trimRequiredString(value))
	@IsOptional()
	@IsString()
	@MaxLength(100)
	countryName?: string

	@ApiPropertyOptional({
		type: String,
		example: 'RU',
		description: 'If omitted, generated from countryName.'
	})
	@Transform(({ value }: { value: unknown }) =>
		trimOptionalUppercaseCode(value)
	)
	@IsOptional()
	@IsString()
	@Matches(REGIONALITY_CODE_PATTERN)
	@MaxLength(8)
	countryCode?: string

	@ApiProperty({ type: String, example: 'Чеченская республика' })
	@Transform(({ value }: { value: unknown }) => trimRequiredString(value))
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	regionName: string

	@ApiPropertyOptional({
		type: String,
		example: 'RU-CE',
		description: 'If omitted, generated from countryCode and regionName.'
	})
	@Transform(({ value }: { value: unknown }) =>
		trimOptionalUppercaseCode(value)
	)
	@IsOptional()
	@IsString()
	@Matches(REGIONALITY_CODE_PATTERN)
	@MaxLength(64)
	regionCode?: string
}
