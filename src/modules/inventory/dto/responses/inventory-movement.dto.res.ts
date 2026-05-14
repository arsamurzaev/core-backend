import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

import { InventoryStockBalanceDto } from './inventory-stock-balance.dto.res'

export class InventoryMovementDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	warehouseId: string

	@ApiPropertyOptional({ type: String, nullable: true })
	variantId?: string | null

	@ApiProperty({ type: String })
	type: string

	@ApiProperty({ type: String })
	source: string

	@ApiProperty({ type: Number })
	quantityDelta: number

	@ApiPropertyOptional({ type: Number, nullable: true })
	quantityAfter?: number | null

	@ApiPropertyOptional({ type: String, nullable: true })
	reason?: string | null

	@ApiProperty({ type: String, format: 'date-time' })
	occurredAt: string

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: string
}

export class InventoryStockAdjustmentDto {
	@ApiProperty({ type: Boolean })
	ok: boolean

	@ApiProperty({ type: InventoryStockBalanceDto })
	balance: InventoryStockBalanceDto

	@ApiProperty({ type: InventoryMovementDto })
	movement: InventoryMovementDto

	@ApiProperty({ type: Number })
	variantStock: number
}
