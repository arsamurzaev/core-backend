import { ProductVariantStatus } from '@generated/enums'
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

export class ProductVariantSaleUnitDtoReq {
	@ApiProperty({
		type: String,
		example: 'catalog-sale-unit-id',
		description:
			'Ссылка на активную единицу продажи из справочника текущего каталога.'
	})
	@IsString()
	@IsNotEmpty()
	catalogSaleUnitId: string

	@ApiPropertyOptional({
		type: String,
		example: 'box-12',
		description:
			'Не используется для создания справочника: локальная привязка берет код из catalogSaleUnitId.'
	})
	@IsOptional()
	@IsString()
	@MaxLength(100)
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined || value === null) return undefined
		if (typeof value !== 'string') return value
		const trimmed = value.trim()
		return trimmed.length ? trimmed : undefined
	})
	code?: string

	@ApiPropertyOptional({
		type: String,
		example: 'Короб',
		description:
			'Не используется для создания справочника: локальная привязка берет название из catalogSaleUnitId.'
	})
	@IsOptional()
	@IsString()
	@MaxLength(255)
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined || value === null) return undefined
		if (typeof value !== 'string') return value
		const trimmed = value.trim()
		return trimmed.length ? trimmed : undefined
	})
	name?: string

	@ApiProperty({
		type: Number,
		example: 12,
		description: 'Сколько базовых единиц внутри для конкретного товара/варианта.'
	})
	@Type(() => Number)
	@IsNumber()
	@Min(0.0001)
	baseQuantity: number

	@ApiProperty({ type: Number, example: 999 })
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	price: number

	@ApiPropertyOptional({ type: String, example: '4601234567890' })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined) return undefined
		if (value === null) return null
		if (typeof value !== 'string') return value
		const trimmed = value.trim()
		return trimmed.length ? trimmed : null
	})
	barcode?: string | null

	@ApiPropertyOptional({ type: Boolean, example: true })
	@IsOptional()
	@IsBoolean()
	isDefault?: boolean

	@ApiPropertyOptional({ type: Boolean, example: true })
	@IsOptional()
	@IsBoolean()
	isActive?: boolean

	@ApiPropertyOptional({ type: Number, example: 0 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	displayOrder?: number
}

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
	@ApiPropertyOptional({ type: Number, example: 0, nullable: true })
	@IsOptional()
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined) return undefined
		if (value === null) return null
		if (typeof value === 'string' && value.trim().length === 0) return null
		return Number(value)
	})
	@IsNumber()
	@Min(0)
	price?: number | null

	@ApiPropertyOptional({
		type: Number,
		example: 10,
		nullable: true,
		description: 'null означает, что остаток не ведется'
	})
	@IsOptional()
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined) return undefined
		if (value === null) return null
		if (typeof value === 'string' && value.trim().length === 0) return null
		return Number(value)
	})
	@IsInt()
	@Min(0)
	stock?: number | null

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

	@ApiPropertyOptional({ type: [ProductVariantSaleUnitDtoReq] })
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => ProductVariantSaleUnitDtoReq)
	saleUnits?: ProductVariantSaleUnitDtoReq[]
}
