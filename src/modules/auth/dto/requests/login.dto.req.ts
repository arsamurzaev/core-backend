import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator'

export class LoginDtoReq {
	@ApiProperty({ example: 'login' })
	@IsString()
	@IsNotEmpty()
	@MinLength(3)
	@MaxLength(25)
	login: string

	@ApiProperty({ example: 'password' })
	@IsString()
	@IsNotEmpty()
	@MinLength(8)
	@MaxLength(25)
	password: string
}
