import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator'

const BRAND_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export class UpdateBrandDtoReq {
	@ApiPropertyOptional({ type: String, example: 'Nike' })
	@IsOptional()
	@IsString()
	@MaxLength(255)
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' ? value.trim() : value
	)
	name?: string

	@ApiPropertyOptional({ type: String, example: 'nike' })
	@IsOptional()
	@IsString()
	@MaxLength(255)
	@Matches(BRAND_SLUG_PATTERN)
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' ? value.trim().toLowerCase() : value
	)
	slug?: string
}
