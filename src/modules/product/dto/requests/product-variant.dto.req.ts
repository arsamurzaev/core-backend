import { ProductVariantStatus } from '@generated/enums'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
	ArrayMinSize,
	IsArray,
	IsBoolean,
	IsEnum,
	IsInt,
	IsNotEmpty,
	IsNumber,
	IsOptional,
	IsString,
	Matches,
	MaxLength,
	Min,
	ValidateNested
} from 'class-validator'

const SKU_PATTERN = /^[A-Za-z0-9_-]+$/

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
	@ApiPropertyOptional({
		type: String,
		example: 'TSHIRT-001-S-WHT',
		description: 'Если не указан, будет сгенерирован автоматически'
	})
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@Matches(SKU_PATTERN)
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined || value === null) return undefined
		if (typeof value === 'string') {
			const trimmed = value.trim()
			return trimmed.length ? trimmed : undefined
		}
		if (typeof value === 'number' || typeof value === 'boolean') {
			return String(value).trim()
		}
		return undefined
	})
	sku?: string

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

	@ApiProperty({ type: [ProductVariantAttributeDtoReq] })
	@IsArray()
	@ArrayMinSize(1)
	@ValidateNested({ each: true })
	@Type(() => ProductVariantAttributeDtoReq)
	attributes: ProductVariantAttributeDtoReq[]
}
