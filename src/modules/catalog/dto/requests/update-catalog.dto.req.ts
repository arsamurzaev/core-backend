import { CatalogStatus, ProductsDisplayMode } from '@generated/enums'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
	IsBoolean,
	IsEnum,
	IsOptional,
	IsString,
	Matches,
	MaxLength,
	MinLength
} from 'class-validator'

const SLUG_PATTERN = /^[a-z0-9-]+$/
const DOMAIN_PATTERN = /^[a-z0-9.-]+$/

export class UpdateCatalogDtoReq {
	@ApiPropertyOptional({ type: String, example: 'catalog' })
	@IsOptional()
	@IsString()
	@Matches(SLUG_PATTERN)
	@Transform(({ value }) =>
		value === undefined ? value : String(value).trim().toLowerCase()
	)
	slug?: string

	@ApiPropertyOptional({
		type: String,
		example: 'example.com',
		nullable: true
	})
	@IsOptional()
	@IsString()
	@Matches(DOMAIN_PATTERN)
	@Transform(({ value }) => {
		if (value === undefined) return undefined
		if (value === null) return null
		const normalized = String(value).trim().toLowerCase()
		return normalized.length ? normalized : null
	})
	domain?: string | null

	@ApiPropertyOptional({ type: String, example: 'Catalog name' })
	@IsOptional()
	@IsString()
	name?: string

	@ApiPropertyOptional({ type: String, example: CatalogStatus.PROPOSAL })
	@IsOptional()
	@IsEnum(CatalogStatus)
	status?: CatalogStatus

	@ApiPropertyOptional({ type: String, example: 'login' })
	@IsOptional()
	@IsString()
	@Transform(({ value }) =>
		value === undefined ? value : String(value).trim().toLowerCase()
	)
	login?: string

	@ApiPropertyOptional({ type: String, example: 'password' })
	@IsOptional()
	@IsString()
	@MinLength(8)
	@MaxLength(24)
	password?: string

	@ApiPropertyOptional({ type: String, example: 'type ID' })
	@IsOptional()
	@IsString()
	typeId?: string

	@ApiPropertyOptional({
		type: String,
		example: 'parent ID',
		nullable: true
	})
	@IsOptional()
	@IsString()
	@Transform(({ value }) => {
		if (value === undefined) return undefined
		if (value === null) return null
		const normalized = String(value).trim()
		return normalized.length ? normalized : null
	})
	parentId?: string | null

	@ApiPropertyOptional({
		type: String,
		example: 'user ID',
		nullable: true
	})
	@IsOptional()
	@IsString()
	@Transform(({ value }) => {
		if (value === undefined) return undefined
		if (value === null) return null
		const normalized = String(value).trim()
		return normalized.length ? normalized : null
	})
	userId?: string | null

	@ApiPropertyOptional({ type: String, example: 'About' })
	@IsOptional()
	@IsString()
	about?: string

	@ApiPropertyOptional({ type: String, example: 'Description' })
	@IsOptional()
	@IsString()
	description?: string

	@ApiPropertyOptional({ type: String, example: 'USD' })
	@IsOptional()
	@IsString()
	currency?: string

	@ApiPropertyOptional({
		type: String,
		example: 'https://cdn.example/logo.png'
	})
	@IsOptional()
	@IsString()
	logoUrl?: string

	@ApiPropertyOptional({
		type: String,
		example: 'https://cdn.example/bg.png'
	})
	@IsOptional()
	@IsString()
	bgUrl?: string

	@ApiPropertyOptional({ type: String, example: 'Note' })
	@IsOptional()
	@IsString()
	note?: string

	@ApiPropertyOptional({ type: Boolean, example: true })
	@IsOptional()
	@IsBoolean()
	isActive?: boolean

	@ApiPropertyOptional({ type: Boolean, example: true })
	@IsOptional()
	@IsBoolean()
	isCommerceEnabled?: boolean

	@ApiPropertyOptional({ type: String, example: ProductsDisplayMode.LIST })
	@IsOptional()
	@IsEnum(ProductsDisplayMode)
	productsDisplayMode?: ProductsDisplayMode
}
