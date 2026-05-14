import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
	IsInt,
	IsOptional,
	IsString,
	IsUUID,
	MaxLength,
	NotEquals
} from 'class-validator'

export class CreateInventoryStockAdjustmentDtoReq {
	@ApiProperty({ type: String, format: 'uuid' })
	@IsUUID()
	variantId: string

	@ApiProperty({
		type: Number,
		example: 5,
		description: 'Positive value is receipt, negative value is write-off'
	})
	@IsInt()
	@NotEquals(0)
	quantityDelta: number

	@ApiPropertyOptional({
		type: String,
		example: 'Manual correction after count'
	})
	@IsOptional()
	@IsString()
	@MaxLength(255)
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' ? value.trim() : value
	)
	reason?: string
}
