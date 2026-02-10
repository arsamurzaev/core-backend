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
const SLUG_MIN_LENGTH = 2
const SLUG_MAX_LENGTH = 63

export class CreateCatalogDtoReq {
	@ApiPropertyOptional({
		type: String,
		example: 'catalog',
		description: 'Если не указан, будет сгенерирован автоматически'
	})
	@Transform(({ value }) => {
		if (value === undefined || value === null) return value
		const normalized = String(value).trim().toLowerCase()
		return normalized.length ? normalized : undefined
	})
	@IsOptional()
	@Matches(SLUG_PATTERN)
	@MinLength(SLUG_MIN_LENGTH)
	@MaxLength(SLUG_MAX_LENGTH)
	@IsString({ message: 'РРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ РєР°С‚Р°Р»РѕРіР° РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ СЃС‚СЂРѕРєРѕРёМ†' })
	@IsNotEmpty({ message: 'РРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ РєР°С‚Р°Р»РѕРіР° РЅРµ РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ РїСѓСЃС‚С‹Рј' })
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
	@Transform(({ value }) => {
		if (value === undefined) return undefined
		if (value === null) return null
		const normalized = String(value).trim().toLowerCase()
		return normalized.length ? normalized : null
	})
	domain?: string | null

	@ApiProperty({ type: String, example: 'type ID' })
	@IsString({ message: 'Тип каталога должен быть строкой' })
	@IsNotEmpty({ message: 'Тип каталога не должен быть пустым' })
	typeId: string

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

	@ApiProperty({ type: String, example: 'Каталог' })
	@IsString({ message: 'Название каталога должно быть строкой' })
	@IsNotEmpty({ message: 'Название каталога не должно быть пустым' })
	name: string

	@ApiProperty({ type: String, example: CatalogStatus.PROPOSAL })
	@IsEnum(CatalogStatus, {
		message: 'Неверный статус каталога'
	})
	@IsNotEmpty({ message: 'Статус каталога не должен быть пустым' })
	status: CatalogStatus

	// @ApiProperty({ type: String, example: 'login' })
	// @IsString({ message: 'Логин должен быть строкой' })
	// @IsNotEmpty({ message: 'Логин не может быть пустым' })
	// @Transform(({ value }) => String(value).trim().toLowerCase())
	// login: string

	// @ApiProperty({ type: String, example: 'password' })
	// @IsString({ message: 'Пароль должен быть строкой' })
	// @MinLength(8, { message: 'Пароль не должен быть короче 8 символов' })
	// @MaxLength(24, { message: 'Пароль не должен превышать 24 символов' })
	// @IsNotEmpty({ message: 'Пароль не может быть пустым' })
	// password: string

	// @ApiProperty({ type: String, example: 'id рода деятельности' })
	// @IsString({ message: 'id рода деятельности должен быть строкой' })
	// @IsNotEmpty({ message: 'id рода деятельности не может быть пустым' })
	// activityIds: string[]
}
