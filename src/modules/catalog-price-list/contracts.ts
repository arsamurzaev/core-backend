import type { Prisma } from '@generated/client'
import type { CatalogPriceListPriceTarget } from '@generated/enums'

import type { BulkUpsertCatalogPriceListPricesDtoReq } from './dto/requests/catalog-price-list-price.dto.req'
import type {
	CreateCatalogPriceListDtoReq,
	UpdateCatalogPriceListDtoReq
} from './dto/requests/catalog-price-list.dto.req'
import type { SetActivePriceListDtoReq } from './dto/requests/set-active-price-list.dto.req'
import type {
	ActiveCatalogPriceListDto,
	CatalogPriceListDto,
	CatalogPriceListPriceDto
} from './dto/responses/catalog-price-list.dto.res'

export const CATALOG_PRICE_LIST_MANAGEMENT_PORT = Symbol(
	'CATALOG_PRICE_LIST_MANAGEMENT_PORT'
)
export const CATALOG_PRICE_LIST_RESOLVER_PORT = Symbol(
	'CATALOG_PRICE_LIST_RESOLVER_PORT'
)

export type CatalogPriceListListOptions = {
	includeArchived?: boolean
	includeInactive?: boolean
}

export interface CatalogPriceListManagementPort {
	getAll(options: CatalogPriceListListOptions): Promise<CatalogPriceListDto[]>
	create(dto: CreateCatalogPriceListDtoReq): Promise<CatalogPriceListDto>
	update(
		id: string,
		dto: UpdateCatalogPriceListDtoReq
	): Promise<CatalogPriceListDto>
	archive(id: string): Promise<{ ok: boolean }>
	getPrices(
		id: string,
		includeArchived?: boolean
	): Promise<CatalogPriceListPriceDto[]>
	bulkUpsertPrices(
		id: string,
		dto: BulkUpsertCatalogPriceListPricesDtoReq
	): Promise<CatalogPriceListPriceDto[]>
	setActivePriceList(
		dto: SetActivePriceListDtoReq
	): Promise<ActiveCatalogPriceListDto>
}

export type CatalogPriceListSnapshot = {
	id: string
	code: string
	name: string
}

export type CatalogPriceListProductPriceContext = {
	priceList: CatalogPriceListSnapshot | null
	productPrices: Map<string, string>
	variantPrices: Map<string, string>
	saleUnitPrices: Map<string, string>
}

export type CatalogPriceListLinePrice = {
	priceList: CatalogPriceListSnapshot | null
	price: string | null
	target: CatalogPriceListPriceTarget | null
	targetId: string | null
}

export type CatalogPriceListProductPriceContextParams = {
	buyerCatalogId: string
	ownerCatalogId: string
	productIds: string[]
	tx?: Prisma.TransactionClient
}

export type CatalogPriceListLinePriceParams = {
	buyerCatalogId: string
	ownerCatalogId: string
	productId: string
	variantId?: string | null
	saleUnitId?: string | null
	mode: 'SIMPLE' | 'MATRIX'
	tx?: Prisma.TransactionClient
}

export type CatalogPriceListActivePriceListParams = {
	buyerCatalogId: string
	ownerCatalogId?: string | null
	tx?: Prisma.TransactionClient
}

export interface CatalogPriceListResolverPort {
	resolveProductPriceContext(
		params: CatalogPriceListProductPriceContextParams
	): Promise<CatalogPriceListProductPriceContext>
	resolveLinePrice(
		params: CatalogPriceListLinePriceParams
	): Promise<CatalogPriceListLinePrice>
	resolveActivePriceList(
		params: CatalogPriceListActivePriceListParams
	): Promise<CatalogPriceListSnapshot | null>
}
