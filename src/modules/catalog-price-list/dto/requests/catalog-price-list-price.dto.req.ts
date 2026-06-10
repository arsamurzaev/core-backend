import { CatalogPriceListPriceTarget } from '@generated/enums'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
	ArrayMaxSize,
	IsArray,
	IsEnum,
	IsNumber,
	IsOptional,
	IsString,
	Min,
	ValidateNested
} from 'class-validator'

export class CatalogPriceListPriceInputDtoReq {
	@ApiProperty({ enum: CatalogPriceListPriceTarget })
	@IsEnum(CatalogPriceListPriceTarget)
	target: CatalogPriceListPriceTarget

	@ApiProperty({ type: String })
	@IsString()
	targetId: string

	@ApiPropertyOptional({
		type: Number,
		nullable: true,
		description: 'Null удаляет цену из этого прайс-листа.'
	})
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	price?: number | null
}

export class BulkUpsertCatalogPriceListPricesDtoReq {
	@ApiProperty({ type: [CatalogPriceListPriceInputDtoReq] })
	@IsArray()
	@ArrayMaxSize(2000)
	@ValidateNested({ each: true })
	@Type(() => CatalogPriceListPriceInputDtoReq)
	prices: CatalogPriceListPriceInputDtoReq[]
}
