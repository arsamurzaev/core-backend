import { IsNotEmpty, IsString } from 'class-validator'

export class UpdateTypeDtoReq {
	@IsString({ message: 'Тип должен быть строкой' })
	@IsNotEmpty({ message: 'Имя типа не может быть пустым' })
	name: string

	@IsString({ message: 'Программный код должен быть строкой' })
	@IsNotEmpty({ message: 'Программный код типа не может быть пустым' })
	code: string
}
