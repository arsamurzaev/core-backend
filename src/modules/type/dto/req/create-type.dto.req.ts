﻿import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
	IsNotEmpty,
	IsOptional,
	IsString,
	Matches,
	MaxLength,
	MinLength
} from 'class-validator'

const CODE_PATTERN = /^[a-z0-9-]+$/

export class CreateTypeDtoReq {
	@ApiProperty({ type: String, example: 'РўРёРї' })
	@IsString({ message: 'РўРёРї РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ СЃС‚СЂРѕРєРѕРёМ†' })
	@IsNotEmpty({ message: 'РРјСЏ С‚РёРїР° РЅРµ РјРѕР¶РµС‚ Р±С‹С‚СЊ РїСѓСЃС‚С‹Рј' })
	@MaxLength(255)
	@Transform(({ value }) => String(value).trim().toLowerCase())
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
	@Matches(CODE_PATTERN)
	@Transform(({ value }) => {
		if (value === undefined || value === null) return value
		const normalized = String(value).trim().toLowerCase()
		return normalized.length ? normalized : undefined
	})
	code?: string
}
