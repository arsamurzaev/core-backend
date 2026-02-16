﻿import { ProductVariantStatus } from '@generated/enums'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
	IsArray,
	IsBoolean,
	IsEnum,
	IsInt,
	IsNotEmpty,
	IsNumber,
	IsOptional,
	IsString,
	MaxLength,
	Min,
	ValidateNested
} from 'class-validator'

export class ProductVariantAttributeDtoReq {
	@ApiProperty({ type: String, example: 'attribute-id' })
	@IsString()
	@IsNotEmpty()
	attributeId: string

	@ApiPropertyOptional({
		type: String,
		example: 'enum-value-id',
		description: 'Идентификатор значения перечисления'
	})
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	enumValueId?: string

	@ApiPropertyOptional({
		type: String,
		example: '1.5л',
		description:
			'Сырой текст значения. Разрешён, если у атрибута нет фиксированных значений'
	})
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined || value === null) return undefined
		if (typeof value === 'string') {
			const trimmed = value.trim()
			return trimmed.length ? trimmed : undefined
		}
		if (typeof value === 'number' || typeof value === 'boolean') {
			const trimmed = String(value).trim()
			return trimmed.length ? trimmed : undefined
		}
		return undefined
	})
	value?: string
}

export class ProductVariantDtoReq {
	@ApiPropertyOptional({ type: Number, example: 0 })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	price?: number

	@ApiPropertyOptional({ type: Number, example: 10 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	stock?: number

	@ApiPropertyOptional({ type: Boolean, example: true })
	@IsOptional()
	@IsBoolean()
	isAvailable?: boolean

	@ApiPropertyOptional({ enum: ProductVariantStatus, example: 'ACTIVE' })
	@IsOptional()
	@IsEnum(ProductVariantStatus)
	status?: ProductVariantStatus

	@ApiPropertyOptional({ type: [ProductVariantAttributeDtoReq] })
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => ProductVariantAttributeDtoReq)
	attributes?: ProductVariantAttributeDtoReq[]
}
