import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
	IsNotEmpty,
	IsOptional,
	IsString,
	Matches,
	MaxLength,
	MinLength
} from 'class-validator'

import { TYPE_CODE_PATTERN } from '../../type.utils'

export class CreateTypeDtoReq {
	@ApiProperty({ type: String, example: 'Тип' })
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

	@ApiPropertyOptional({
		type: String,
		example: 'default',
		description: 'Если не указан, будет сгенерирован автоматически'
	})
	@IsOptional()
	@IsString({ message: 'Программный код должен быть строкой' })
	@IsNotEmpty({ message: 'Программный код типа не может быть пустым' })
	@MinLength(2)
	@MaxLength(50)
	@Matches(TYPE_CODE_PATTERN)
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined || value === null) return value
		if (typeof value !== 'string') return value
		const normalized = value.trim().toLowerCase()
		return normalized.length ? normalized : undefined
	})
	code?: string
}
