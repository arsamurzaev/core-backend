import { Role } from '@generated/enums'
import { ApiProperty } from '@nestjs/swagger'
import {
	IsArray,
	IsEnum,
	IsNotEmpty,
	IsString,
	MaxLength,
	MinLength
} from 'class-validator'

export class CreateUserDtoReq {
	@ApiProperty({
		type: String,
		example: 'login',
		examples: ['login', 'admin', 'user']
	})
	@IsString({ message: 'Логин должен быть строкой' })
	@MaxLength(25, { message: 'Логин не должен превышать 25 символов' })
	@IsNotEmpty({ message: 'Логин не может быть пустым' })
	@MinLength(3, { message: 'Логин не должен быть короче 3 символов' })
	login: string

	@ApiProperty({
		type: String,
		example: 'password',
		examples: ['password', 'admin', 'user']
	})
	@IsString({ message: 'Пароль должен быть строкой' })
	@IsNotEmpty({ message: 'Пароль не может быть пустым' })
	@MinLength(8, { message: 'Пароль не должен быть короче 8 символов' })
	@MaxLength(25, { message: 'Пароль не должен превышать 25 символов' })
	password: string

	@ApiProperty({
		type: String,
		example: 'name',
		examples: ['name', 'admin', 'user']
	})
	@IsString({ message: 'Имя должно быть строкой' })
	@IsNotEmpty({ message: 'Имя не может быть пустым' })
	@MaxLength(25, { message: 'Имя не должно превышать 25 символов' })
	@MinLength(2, { message: 'Имя не должно быть короче 2 символов' })
	name: string

	@ApiProperty({
		type: String,
		example: 'role',
		examples: ['role', 'admin', 'user']
	})
	@IsNotEmpty({ message: 'Роль не может быть пустой' })
	@IsEnum([Role.USER, Role.CATALOG_OWNER, Role.ADMIN], {
		message: 'Некорректная роль'
	})
	@MinLength(5, { message: 'Роль не должна быть короче 5 символов' })
	@MaxLength(25, { message: 'Роль не должна превышать 25 символов' })
	role: Role

	@ApiProperty({
		type: String,
		example: 'regionalityIds'
	})
	@IsArray({ message: 'Региональность должна быть массивом' })
	regionalityIds?: string[]
}
