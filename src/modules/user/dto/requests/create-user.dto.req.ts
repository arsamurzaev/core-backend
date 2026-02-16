import { Role } from '@generated/enums'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
	IsArray,
	IsEnum,
	IsNotEmpty,
	IsOptional,
	IsString,
	MaxLength,
	MinLength
} from 'class-validator'

export class CreateUserDtoReq {
	@ApiProperty({ example: 'login' })
	@IsString({ message: 'Логин должен быть строкой' })
	@MaxLength(25, { message: 'Логин не должен превышать 25 символов' })
	@IsNotEmpty({ message: 'Логин не может быть пустым' })
	@MinLength(3, { message: 'Логин не должен быть короче 3 символов' })
	login: string

	@ApiProperty({ example: 'password' })
	@IsString({ message: 'Пароль должен быть строкой' })
	@IsNotEmpty({ message: 'Пароль не может быть пустым' })
	@MinLength(8, { message: 'Пароль не должен быть короче 8 символов' })
	@MaxLength(25, { message: 'Пароль не должен превышать 25 символов' })
	password: string

	@ApiProperty({ example: 'name' })
	@IsString({ message: 'Имя должно быть строкой' })
	@IsNotEmpty({ message: 'Имя не может быть пустым' })
	@MaxLength(25, { message: 'Имя не должно превышать 25 символов' })
	@MinLength(2, { message: 'Имя не должно быть короче 2 символов' })
	name: string

	@ApiProperty({
		enum: Role,
		enumName: 'Role',
		example: Role.USER
	})
	@IsNotEmpty({ message: 'Роль не может быть пустой' })
	@IsEnum(Role, { message: 'Некорректная роль' })
	role: Role

	@ApiPropertyOptional({
		type: [String],
		example: ['id1', 'id2']
	})
	@IsOptional()
	@IsArray({ message: 'Региональность должна быть массивом' })
	regionalityIds?: string[]
}
