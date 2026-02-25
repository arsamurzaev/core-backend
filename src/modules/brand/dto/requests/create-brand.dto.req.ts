import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator'

const BRAND_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export class CreateBrandDtoReq {
	@ApiProperty({ type: String, example: 'Nike' })
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' ? value.trim() : value
	)
	name: string

	@ApiProperty({ type: String, example: 'nike' })
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	@Matches(BRAND_SLUG_PATTERN)
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' ? value.trim().toLowerCase() : value
	)
	slug: string
}
