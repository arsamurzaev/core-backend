import { ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { IsBoolean, IsOptional } from 'class-validator'

import { CreateProductTypeDtoReq } from './create-product-type.dto.req'

export class UpdateProductTypeDtoReq extends PartialType(
	CreateProductTypeDtoReq
) {
	@ApiPropertyOptional({ type: Boolean, example: true })
	@IsOptional()
	@IsBoolean()
	isActive?: boolean
}
