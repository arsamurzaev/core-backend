import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsString } from 'class-validator'

export class CreateTypeDtoReq {
	@ApiProperty({ type: String, example: 'Тип' })
	@IsString({ message: 'Тип должен быть строкой' })
	@IsNotEmpty({ message: 'Имя типа не может быть пустым' })
	name: string

	@ApiProperty({ type: String, example: 'default' })
	@IsString({ message: 'Программный код должен быть строкой' })
	@IsNotEmpty({ message: 'Программный код типа не может быть пустым' })
	code: string
}
