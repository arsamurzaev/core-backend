import { CatalogExperienceMode, CatalogStatus, ContactType } from '@generated/enums'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
	ArrayNotEmpty,
	ArrayMaxSize,
	IsArray,
	IsBoolean,
	IsEnum,
	IsOptional,
	IsString,
	Matches,
	MaxLength,
	MinLength,
	ValidateNested
} from 'class-validator'

const SLUG_PATTERN = /^[a-z0-9-]+$/
const DOMAIN_PATTERN = /^[a-z0-9.-]+$/
const SLUG_MIN_LENGTH = 2
const SLUG_MAX_LENGTH = 63

export class UpdateCatalogContactDtoReq {
	@ApiPropertyOptional({ enum: ContactType, example: ContactType.PHONE })
	@IsEnum(ContactType)
	type: ContactType

	@ApiPropertyOptional({ type: Number, example: 0 })
	@IsOptional()
	position?: number

	@ApiPropertyOptional({ type: String, example: '+79991234567' })
	@IsString()
	@Transform(({ value }: { value: unknown }) => {
		if (typeof value !== 'string') return value
		return value.trim()
	})
	value: string
}

export class UpdateCatalogDtoReq {
	@ApiPropertyOptional({ type: String, example: 'catalog' })
	@IsOptional()
	@IsString()
	@Matches(SLUG_PATTERN)
	@MinLength(SLUG_MIN_LENGTH)
	@MaxLength(SLUG_MAX_LENGTH)
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined || value === null) return value
		if (typeof value !== 'string') return value
		const normalized = value.trim().toLowerCase()
		return normalized.length ? normalized : undefined
	})
	slug?: string

	@ApiPropertyOptional({
		type: String,
		example: 'example.com',
		nullable: true
	})
	@IsOptional()
	@IsString()
	@MaxLength(253)
	@Matches(DOMAIN_PATTERN)
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined) return undefined
		if (value === null) return null
		if (typeof value !== 'string') return value
		const normalized = value.trim().toLowerCase()
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
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined) return undefined
		if (value === null) return null
		if (typeof value !== 'string') return value
		const normalized = value.trim()
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
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined) return undefined
		if (value === null) return null
		if (typeof value !== 'string') return value
		const normalized = value.trim()
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
		example: 'media-uuid'
	})
	@IsOptional()
	@IsString()
	logoMediaId?: string

	@ApiPropertyOptional({
		type: String,
		example: 'media-uuid'
	})
	@IsOptional()
	@IsString()
	bgMediaId?: string

	@ApiPropertyOptional({ type: String, example: 'Note' })
	@IsOptional()
	@IsString()
	note?: string

	@ApiPropertyOptional({ type: Boolean, example: true })
	@IsOptional()
	@IsBoolean()
	isActive?: boolean

	@ApiPropertyOptional({
		enum: CatalogExperienceMode,
		example: CatalogExperienceMode.DELIVERY
	})
	@IsOptional()
	@IsEnum(CatalogExperienceMode)
	defaultMode?: CatalogExperienceMode

	@ApiPropertyOptional({
		enum: CatalogExperienceMode,
		isArray: true,
		example: [CatalogExperienceMode.DELIVERY, CatalogExperienceMode.BROWSE]
	})
	@IsOptional()
	@IsArray()
	@ArrayNotEmpty()
	@IsEnum(CatalogExperienceMode, { each: true })
	allowedModes?: CatalogExperienceMode[]

	@ApiPropertyOptional({
		type: String,
		example: 'google-site-verification=abc123',
		nullable: true
	})
	@IsOptional()
	@IsString()
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined) return undefined
		if (value === null) return null
		if (typeof value !== 'string') return value
		const normalized = value.trim()
		return normalized.length ? normalized : null
	})
	googleVerification?: string | null

	@ApiPropertyOptional({
		type: String,
		example: 'yandex-verification: abc123',
		nullable: true
	})
	@IsOptional()
	@IsString()
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined) return undefined
		if (value === null) return null
		if (typeof value !== 'string') return value
		const normalized = value.trim()
		return normalized.length ? normalized : null
	})
	yandexVerification?: string | null

	@ApiPropertyOptional({
		type: [UpdateCatalogContactDtoReq],
		description:
			'Полный набор контактов каталога. При передаче существующие контакты заменяются.'
	})
	@IsOptional()
	@IsArray()
	@ArrayMaxSize(8)
	@ValidateNested({ each: true })
	@Type(() => UpdateCatalogContactDtoReq)
	contacts?: UpdateCatalogContactDtoReq[]
}
