import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'

function normalizeString(value: unknown): string | undefined {
	if (
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean' ||
		typeof value === 'bigint'
	) {
		return String(value).trim()
	}
	return undefined
}

export class CreateAttributeEnumAliasDtoReq {
	@ApiProperty({ type: String, example: 'black' })
	@Transform(({ value }: { value: unknown }) => normalizeString(value))
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	value: string

	@ApiPropertyOptional({ type: String, example: 'Black' })
	@IsOptional()
	@Transform(({ value }: { value: unknown }) => normalizeString(value))
	@IsString()
	@MaxLength(255)
	displayName?: string
}
