import type { OkResponseDto } from '@/shared/http/dto/ok.response.dto'
import type { MediaDto } from '@/shared/media/dto/media.dto.res'

import type { CategoryProductsPage } from './category-products.utils'
import type { CreateCategoryDtoReq } from './dto/requests/create-category.dto.req'
import type { UpdateCategoryPositionDtoReq } from './dto/requests/update-category-position.dto.req'
import type { UpdateCategoryPositionsDtoReq } from './dto/requests/update-category-positions.dto.req'
import type { UpdateCategoryDtoReq } from './dto/requests/update-category.dto.req'

export const CATEGORY_READER_PORT = Symbol('CATEGORY_READER_PORT')
export const CATEGORY_COMMAND_PORT = Symbol('CATEGORY_COMMAND_PORT')

export type CategoryListOptions = {
	includeEmpty?: boolean
	includeInactive?: boolean
}

export type CategoryProductsReadOptions = {
	cursor?: string
	limit?: number | string
	includeInactive?: boolean
	applyPriceList?: boolean
	enforcePriceListVisibility?: boolean
}

export type CategoryRemoveOptions = {
	deleteProducts?: boolean
}

export type CategoryReadItem = Record<string, unknown> & {
	productCount: number
	imageMedia: MediaDto | null
}

export type CategoryReadDetails = CategoryReadItem & {
	children: CategoryReadItem[]
}

export type CategoryProductsReadPage = CategoryProductsPage<unknown>

export interface CategoryReaderPort {
	getAll(options?: CategoryListOptions): Promise<CategoryReadItem[]>
	getById(id: string): Promise<CategoryReadDetails>
	getProductsByCategory(
		id: string,
		options?: CategoryProductsReadOptions
	): Promise<CategoryProductsReadPage>
	getProductCardsByCategory(
		id: string,
		options?: CategoryProductsReadOptions
	): Promise<CategoryProductsReadPage>
}

export interface CategoryCommandPort {
	create(dto: CreateCategoryDtoReq): Promise<CategoryReadItem>
	update(id: string, dto: UpdateCategoryDtoReq): Promise<CategoryReadDetails>
	updatePosition(
		id: string,
		dto: UpdateCategoryPositionDtoReq
	): Promise<CategoryReadDetails>
	updatePositions(
		dto: UpdateCategoryPositionsDtoReq
	): Promise<CategoryReadItem[]>
	remove(id: string, options?: CategoryRemoveOptions): Promise<OkResponseDto>
}
