import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

import { INVENTORY_WAREHOUSE_STATUS } from '../../inventory.constants'

export class InventoryWarehouseDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: String })
	code: string

	@ApiProperty({ enum: INVENTORY_WAREHOUSE_STATUS })
	status: string

	@ApiPropertyOptional({ type: String, nullable: true })
	address?: string | null

	@ApiProperty({ type: Boolean })
	isDefault: boolean

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: string

	@ApiProperty({ type: String, format: 'date-time' })
	updatedAt: string
}
