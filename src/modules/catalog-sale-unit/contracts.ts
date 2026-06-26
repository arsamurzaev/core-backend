import type { CreateCatalogSaleUnitDtoReq } from './dto/requests/create-catalog-sale-unit.dto.req'
import type { UpdateCatalogSaleUnitDtoReq } from './dto/requests/update-catalog-sale-unit.dto.req'

export const CATALOG_SALE_UNIT_MANAGEMENT_PORT = Symbol(
	'CATALOG_SALE_UNIT_MANAGEMENT_PORT'
)

export type CatalogSaleUnitListOptions = {
	includeInactive?: boolean
	includeArchived?: boolean
}

export interface CatalogSaleUnitManagementPort {
	getAll(options?: CatalogSaleUnitListOptions): Promise<unknown>
	getById(id: string): Promise<unknown>
	create(dto: CreateCatalogSaleUnitDtoReq): Promise<unknown>
	update(id: string, dto: UpdateCatalogSaleUnitDtoReq): Promise<unknown>
	archive(id: string): Promise<{ ok: boolean }>
}
