import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator'

export class ChangePasswordDtoReq {
	@ApiProperty({ example: '00000000' })
	@IsString({ message: 'Текущий пароль должен быть строкой' })
	@IsNotEmpty({ message: 'Текущий пароль не может быть пустым' })
	@MinLength(8, { message: 'Текущий пароль не должен быть короче 8 символов' })
	@MaxLength(25, { message: 'Текущий пароль не должен превышать 25 символов' })
	currentPassword: string

	@ApiProperty({ example: 'newPassword123' })
	@IsString({ message: 'Новый пароль должен быть строкой' })
	@IsNotEmpty({ message: 'Новый пароль не может быть пустым' })
	@MinLength(8, { message: 'Новый пароль не должен быть короче 8 символов' })
	@MaxLength(25, { message: 'Новый пароль не должен превышать 25 символов' })
	newPassword: string
}
