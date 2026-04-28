import { CatalogStatus } from '@generated/enums'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
	IsEnum,
	IsNotEmpty,
	IsOptional,
	IsString,
	Matches,
	MaxLength,
	MinLength
} from 'class-validator'

const SLUG_PATTERN = /^[a-z0-9-]+$/
const DOMAIN_PATTERN = /^[a-z0-9.-]+$/

export class AdminDuplicateCatalogDtoReq {
	@ApiProperty({ type: String, example: 'Catalog copy name' })
	@IsString()
	@IsNotEmpty()
	name: string

	@ApiProperty({ type: String, example: 'type uuid' })
	@IsString()
	@IsNotEmpty()
	typeId: string

	@ApiProperty({ enum: CatalogStatus })
	@IsEnum(CatalogStatus)
	@IsNotEmpty()
	status: CatalogStatus

	@ApiProperty({
		type: String,
		example: 'catalog-copy',
		description: 'Catalog domain/subdomain stored as slug.'
	})
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined || value === null) return value
		if (typeof value !== 'string') return value
		const normalized = value.trim().toLowerCase()
		return normalized.length ? normalized : value
	})
	@Matches(SLUG_PATTERN)
	@MinLength(2)
	@MaxLength(63)
	@IsString()
	@IsNotEmpty()
	slug: string

	@ApiPropertyOptional({
		type: String,
		example: 'copy.example.com',
		nullable: true,
		description: 'New custom domain. Source domain is never copied.'
	})
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined) return undefined
		if (value === null) return null
		if (typeof value !== 'string') return value
		const normalized = value.trim().toLowerCase()
		return normalized.length ? normalized : null
	})
	@IsOptional()
	@IsString()
	@MaxLength(253)
	@Matches(DOMAIN_PATTERN)
	domain?: string | null
}
