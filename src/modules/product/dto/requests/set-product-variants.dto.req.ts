import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator'

import { ProductVariantDtoReq } from './product-variant.dto.req'

export class SetProductVariantsDtoReq {
	@ApiProperty({ type: [ProductVariantDtoReq] })
	@IsArray()
	@ArrayMinSize(1)
	@ValidateNested({ each: true })
	@Type(() => ProductVariantDtoReq)
	variants: ProductVariantDtoReq[]
}
