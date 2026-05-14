import { PartialType } from '@nestjs/swagger'

import { CreateCatalogSaleUnitDtoReq } from './create-catalog-sale-unit.dto.req'

export class UpdateCatalogSaleUnitDtoReq extends PartialType(
	CreateCatalogSaleUnitDtoReq
) {}
