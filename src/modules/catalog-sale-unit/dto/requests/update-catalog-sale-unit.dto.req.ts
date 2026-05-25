import { ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { IsBoolean, IsOptional } from 'class-validator'

import { CreateCatalogSaleUnitDtoReq } from './create-catalog-sale-unit.dto.req'

export class UpdateCatalogSaleUnitDtoReq extends PartialType(
	CreateCatalogSaleUnitDtoReq
) {
	@ApiPropertyOptional({
		type: Boolean,
		description:
			'Soft availability switch for admin dictionaries. Existing product bindings are preserved.'
	})
	@IsOptional()
	@IsBoolean()
	isActive?: boolean
}
