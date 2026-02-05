import { ApiProperty } from '@nestjs/swagger'

export class TypeDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	code: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	createdAt?: string

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	updatedAt?: string

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	deleteAt?: string | null
}
