import { ApiProperty } from '@nestjs/swagger'

export class BrandDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	catalogId: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: String })
	slug: string

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: string

	@ApiProperty({ type: String, format: 'date-time' })
	updatedAt: string
}
