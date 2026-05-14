import { ApiProperty } from '@nestjs/swagger'

export class CatalogSaleUnitDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	catalogId: string

	@ApiProperty({ type: String })
	code: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: String, example: '1.0000' })
	defaultBaseQuantity: string

	@ApiProperty({ type: String, nullable: true })
	barcode: string | null

	@ApiProperty({ type: Boolean })
	isActive: boolean

	@ApiProperty({ type: Number })
	displayOrder: number

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	deleteAt: string | null

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: string

	@ApiProperty({ type: String, format: 'date-time' })
	updatedAt: string
}
