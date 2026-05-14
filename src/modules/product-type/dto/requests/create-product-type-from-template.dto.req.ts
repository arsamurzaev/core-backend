import { PartialType, PickType } from '@nestjs/swagger'

import { CreateProductTypeDtoReq } from './create-product-type.dto.req'

export class CreateProductTypeFromTemplateDtoReq extends PartialType(
	PickType(CreateProductTypeDtoReq, ['code', 'name', 'description'] as const)
) {}
