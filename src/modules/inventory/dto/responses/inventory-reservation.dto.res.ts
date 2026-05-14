import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

import { InventoryBalanceVariantDto } from './inventory-stock-balance.dto.res'

export class InventoryReservationDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	warehouseId: string

	@ApiProperty({ type: String })
	variantId: string

	@ApiProperty({ type: Number })
	quantity: number

	@ApiProperty({ type: String })
	status: string

	@ApiPropertyOptional({ type: String, nullable: true })
	cartId?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	cartItemId?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	orderId?: string | null

	@ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
	expiresAt?: string | null

	@ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
	consumedAt?: string | null

	@ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
	releasedAt?: string | null

	@ApiPropertyOptional({ type: InventoryBalanceVariantDto })
	variant?: InventoryBalanceVariantDto

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: string

	@ApiProperty({ type: String, format: 'date-time' })
	updatedAt: string
}
