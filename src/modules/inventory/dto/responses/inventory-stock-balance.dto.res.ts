import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class InventoryBalanceProductDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: String })
	sku: string

	@ApiProperty({ type: String })
	slug: string
}

export class InventoryBalanceVariantDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	sku: string

	@ApiProperty({ type: String })
	variantKey: string

	@ApiProperty({ type: InventoryBalanceProductDto })
	product: InventoryBalanceProductDto
}

export class InventoryStockBalanceDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	warehouseId: string

	@ApiProperty({ type: String })
	variantId: string

	@ApiProperty({ type: Number })
	quantityOnHand: number

	@ApiProperty({ type: Number })
	quantityReserved: number

	@ApiProperty({ type: Number })
	quantityAvailable: number

	@ApiPropertyOptional({ type: InventoryBalanceVariantDto })
	variant?: InventoryBalanceVariantDto

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: string

	@ApiProperty({ type: String, format: 'date-time' })
	updatedAt: string
}
