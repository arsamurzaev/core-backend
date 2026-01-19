import { CatalogStatus } from '@generated/enums'
import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
	IsEnum,
	IsNotEmpty,
	IsString,
	MaxLength,
	MinLength
} from 'class-validator'

export class CreateCatalogDtoReq {
	@ApiProperty({ type: String, example: 'catalog' })
	@IsString({ message: 'Идентификатор каталога должен быть строкой' })
	@IsNotEmpty({ message: 'Идентификатор каталога не должен быть пустым' })
	slug: string

	@ApiProperty({ type: String, example: 'type ID' })
	@IsString({ message: 'Тип каталога должен быть строкой' })
	@IsNotEmpty({ message: 'Тип каталога не должен быть пустым' })
	typeId: string

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

	@ApiProperty({ type: String, example: 'login' })
	@IsString({ message: 'Логин должен быть строкой' })
	@IsNotEmpty({ message: 'Логин не может быть пустым' })
	@Transform(({ value }) => String(value).trim().toLowerCase())
	login: string

	@ApiProperty({ type: String, example: 'password' })
	@IsString({ message: 'Пароль должен быть строкой' })
	@MinLength(8, { message: 'Пароль не должен быть короче 8 символов' })
	@MaxLength(24, { message: 'Пароль не должен превышать 24 символов' })
	@IsNotEmpty({ message: 'Пароль не может быть пустым' })
	password: string

	// @ApiProperty({ type: String, example: 'id рода деятельности' })
	// @IsString({ message: 'id рода деятельности должен быть строкой' })
	// @IsNotEmpty({ message: 'id рода деятельности не может быть пустым' })
	// activityIds: string[]
}
