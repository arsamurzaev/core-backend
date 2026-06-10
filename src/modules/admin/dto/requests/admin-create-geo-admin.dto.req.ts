import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, type TransformFnParams } from 'class-transformer'
import {
	IsArray,
	IsNotEmpty,
	IsOptional,
	IsString,
	IsUUID,
	MaxLength,
	MinLength,
	ValidateIf
} from 'class-validator'

export class AdminCreateGeoAdminDtoReq {
	@ApiPropertyOptional({
		example: 'geo-chechnya',
		description: 'If omitted, login is generated automatically.'
	})
	@IsOptional()
	@ValidateIf((_, value) => hasOptionalText(value))
	@Transform(({ value }: TransformFnParams) => normalizeOptionalText(value))
	@IsString({ message: 'Логин должен быть строкой' })
	@MinLength(3, { message: 'Логин не должен быть короче 3 символов' })
	@MaxLength(25, { message: 'Логин не должен превышать 25 символов' })
	login?: string

	@ApiPropertyOptional({
		example: 'password123',
		description: 'If omitted, password is generated automatically.'
	})
	@IsOptional()
	@ValidateIf((_, value) => hasOptionalText(value))
	@Transform(({ value }: TransformFnParams) => normalizeOptionalText(value))
	@IsString({ message: 'Пароль должен быть строкой' })
	@MinLength(8, { message: 'Пароль не должен быть короче 8 символов' })
	@MaxLength(25, { message: 'Пароль не должен превышать 25 символов' })
	password?: string

	@ApiProperty({ example: 'Админ Чеченской республики' })
	@IsString({ message: 'Имя должно быть строкой' })
	@IsNotEmpty({ message: 'Имя не может быть пустым' })
	@MinLength(2, { message: 'Имя не должно быть короче 2 символов' })
	@MaxLength(100, { message: 'Имя не должно превышать 100 символов' })
	name: string

	@ApiPropertyOptional({
		type: [String],
		format: 'uuid',
		example: ['00000000-0000-0000-0000-000000000000']
	})
	@IsOptional()
	@IsArray({ message: 'Страны должны быть массивом' })
	@IsUUID('4', { each: true, message: 'Некорректный id страны' })
	countryIds?: string[]

	@ApiPropertyOptional({
		type: [String],
		format: 'uuid',
		example: ['00000000-0000-0000-0000-000000000000']
	})
	@IsOptional()
	@IsArray({ message: 'Регионы должны быть массивом' })
	@IsUUID('4', { each: true, message: 'Некорректный id региона' })
	regionalityIds?: string[]
}

function hasOptionalText(value: unknown) {
	if (value === undefined || value === null) return false
	return typeof value === 'string' ? Boolean(value.trim()) : true
}

function normalizeOptionalText(value: unknown): unknown {
	if (typeof value !== 'string') return value
	const trimmed = value.trim()
	return trimmed || undefined
}
