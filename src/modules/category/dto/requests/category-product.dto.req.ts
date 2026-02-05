import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator'

export class CategoryProductInputDtoReq {
	@ApiProperty({ type: String, example: 'product-id' })
	@IsString()
	@IsNotEmpty()
	productId: string

	@ApiPropertyOptional({ type: Number, example: 0 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	position?: number
}
