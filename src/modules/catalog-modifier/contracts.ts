import type {
	CreateCatalogModifierGroupDtoReq,
	UpdateCatalogModifierGroupDtoReq
} from './dto/requests/catalog-modifier-group.dto.req'
import type {
	CreateCatalogModifierOptionDtoReq,
	UpdateCatalogModifierOptionDtoReq
} from './dto/requests/catalog-modifier-option.dto.req'
import type { SetProductModifiersDtoReq } from './dto/requests/set-product-modifiers.dto.req'
import type {
	CatalogModifierGroupDto,
	CatalogModifierOptionDto,
	CatalogModifierStateDto,
	ProductModifierGroupDto
} from './dto/responses/catalog-modifier.dto.res'

export const CATALOG_MODIFIER_MANAGEMENT_PORT = Symbol(
	'CATALOG_MODIFIER_MANAGEMENT_PORT'
)

export type CatalogModifierListOptions = {
	includeArchived?: boolean
	includeInactive?: boolean
}

export interface CatalogModifierManagementPort {
	getState(
		options?: CatalogModifierListOptions
	): Promise<CatalogModifierStateDto>
	getGroups(
		options: CatalogModifierListOptions
	): Promise<CatalogModifierGroupDto[]>
	getOptions(
		options: CatalogModifierListOptions
	): Promise<CatalogModifierOptionDto[]>
	createGroup(
		dto: CreateCatalogModifierGroupDtoReq
	): Promise<CatalogModifierGroupDto>
	updateGroup(
		id: string,
		dto: UpdateCatalogModifierGroupDtoReq
	): Promise<CatalogModifierGroupDto>
	archiveGroup(id: string): Promise<{ ok: boolean }>
	createOption(
		dto: CreateCatalogModifierOptionDtoReq
	): Promise<CatalogModifierOptionDto>
	updateOption(
		id: string,
		dto: UpdateCatalogModifierOptionDtoReq
	): Promise<CatalogModifierOptionDto>
	archiveOption(id: string): Promise<{ ok: boolean }>
	getProductModifiers(productId: string): Promise<ProductModifierGroupDto[]>
	setProductModifiers(
		productId: string,
		dto: SetProductModifiersDtoReq
	): Promise<ProductModifierGroupDto[]>
}
