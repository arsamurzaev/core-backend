import { CatalogPriceListPriceTarget } from '@generated/enums'
import { ApiProperty } from '@nestjs/swagger'

export class CatalogPriceListDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	catalogId: string

	@ApiProperty({ type: String })
	code: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: Boolean })
	isActive: boolean

	@ApiProperty({ type: Number })
	displayOrder: number

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	deleteAt: string | null
}

export class CatalogPriceListPriceDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	priceListId: string

	@ApiProperty({ enum: CatalogPriceListPriceTarget })
	target: CatalogPriceListPriceTarget

	@ApiProperty({ type: String })
	targetId: string

	@ApiProperty({ type: String })
	productId: string

	@ApiProperty({ type: String, nullable: true })
	variantId: string | null

	@ApiProperty({ type: String, nullable: true })
	saleUnitId: string | null

	@ApiProperty({ type: String, example: '1200.00' })
	price: string

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	deleteAt: string | null
}

export class ActiveCatalogPriceListDto {
	@ApiProperty({ type: String, nullable: true })
	activePriceListId: string | null
}
