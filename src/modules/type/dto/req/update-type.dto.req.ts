import { Transform } from 'class-transformer'
import {
	IsNotEmpty,
	IsString,
	Matches,
	MaxLength,
	MinLength
} from 'class-validator'

const CODE_PATTERN = /^[a-z0-9-]+$/

export class UpdateTypeDtoReq {
	@IsString({ message: 'Тип должен быть строкой' })
	@IsNotEmpty({
		message: 'Имя типа не может быть пустым'
	})
	@MaxLength(255)
	@Transform(({ value }: { value: unknown }) => {
		if (typeof value !== 'string') return value
		return value.trim().toLowerCase()
	})
	name: string

	@IsString({ message: 'Программный код должен быть строкой' })
	@IsNotEmpty({ message: 'Программный код типа не может быть пустым' })
	@MinLength(2)
	@MaxLength(50)
	@Matches(CODE_PATTERN)
	@Transform(({ value }: { value: unknown }) => {
		if (typeof value !== 'string') return value
		return value.trim().toLowerCase()
	})
	code: string
}
