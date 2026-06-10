import { Injectable } from '@nestjs/common'

import {
	assertCurrentCatalogCanManageCatalogContent,
	mustCatalogId
} from '@/shared/tenancy/ctx'

import { ApplyProductTypeChangeDtoReq } from './dto/requests/apply-product-type-change.dto.req'
import { CreateProductDtoReq } from './dto/requests/create-product.dto.req'
import { ProductTypeCompatibilityPreviewDtoReq } from './dto/requests/product-type-compatibility-preview.dto.req'
import {
	SetProductVariantMatrixDtoReq,
	SetProductVariantsDtoReq
} from './dto/requests/set-product-variants.dto.req'
import { UpdateProductCategoryPositionDtoReq } from './dto/requests/update-product-category-position.dto.req'
import { UpdateProductDtoReq } from './dto/requests/update-product.dto.req'
import { ProductTypeCompatibilityPreviewDto } from './dto/responses/product.dto.res'
import { ProductCommandService } from './product-command.service'
import {
	type ProductDefaultVariantPriceMismatchRepairOptions,
	ProductMaintenanceService
} from './product-maintenance.service'
import {
	type ProductReadOptions,
	ProductReadService
} from './product-read.service'
import { ProductTypeChangeService } from './product-type-change.service'

@Injectable()
export class ProductService {
	constructor(
		private readonly reads: ProductReadService,
		private readonly commands: ProductCommandService,
		private readonly productTypeChanges: ProductTypeChangeService,
		private readonly maintenance: ProductMaintenanceService
	) {}

	getAll(options?: ProductReadOptions) {
		return this.reads.getAll(options)
	}

	getPopular(options?: ProductReadOptions) {
		return this.reads.getPopular(options)
	}

	getPopularCards(options?: ProductReadOptions) {
		return this.reads.getPopularCards(options)
	}

	getInfinite(query: Record<string, unknown>, options?: ProductReadOptions) {
		return this.reads.getInfinite(query, options)
	}

	getInfiniteCards(
		query: Record<string, unknown>,
		options?: ProductReadOptions
	) {
		return this.reads.getInfiniteCards(query, options)
	}

	getRecommendationsInfinite(
		query: Record<string, unknown>,
		options?: ProductReadOptions
	) {
		return this.reads.getRecommendationsInfinite(query, options)
	}

	getRecommendationsInfiniteCards(
		query: Record<string, unknown>,
		options?: ProductReadOptions
	) {
		return this.reads.getRecommendationsInfiniteCards(query, options)
	}

	getUncategorizedInfinite(options?: {
		cursor?: string
		limit?: number | string
		includeInactive?: boolean
	}) {
		return this.reads.getUncategorizedInfinite(options)
	}

	getUncategorizedInfiniteCards(options?: {
		cursor?: string
		limit?: number | string
		includeInactive?: boolean
	}) {
		return this.reads.getUncategorizedInfiniteCards(options)
	}

	getById(id: string, options?: ProductReadOptions) {
		return this.reads.getById(id, options)
	}

	getBySlug(slug: string, options?: ProductReadOptions) {
		return this.reads.getBySlug(slug, options)
	}

	async create(dto: CreateProductDtoReq) {
		return this.commands.create(dto)
	}

	async duplicate(id: string) {
		return this.commands.duplicate(id)
	}

	async update(id: string, dto: UpdateProductDtoReq) {
		return this.commands.update(id, dto)
	}

	async previewProductTypeCompatibility(
		id: string,
		dto: ProductTypeCompatibilityPreviewDtoReq
	): Promise<ProductTypeCompatibilityPreviewDto> {
		return this.productTypeChanges.previewProductTypeCompatibility(id, dto)
	}

	async applyProductTypeChange(id: string, dto: ApplyProductTypeChangeDtoReq) {
		return this.productTypeChanges.applyProductTypeChange(id, dto)
	}

	async toggleStatus(id: string) {
		return this.commands.toggleStatus(id)
	}

	async togglePopular(id: string) {
		return this.commands.togglePopular(id)
	}

	async updateCategoryPosition(
		id: string,
		dto: UpdateProductCategoryPositionDtoReq
	) {
		return this.update(id, {
			categoryId: dto.categoryId,
			categoryPosition: dto.position
		})
	}

	async setVariants(id: string, dto: SetProductVariantsDtoReq) {
		return this.commands.setVariants(id, dto)
	}

	async setVariantMatrix(id: string, dto: SetProductVariantMatrixDtoReq) {
		return this.commands.setVariantMatrix(id, dto)
	}

	async remove(id: string) {
		return this.commands.remove(id)
	}

	async expireScheduledDiscounts(now = new Date()) {
		return this.maintenance.expireScheduledDiscounts(now)
	}

	async repairMissingDefaultVariantsForCurrentCatalog() {
		assertCurrentCatalogCanManageCatalogContent()
		return this.maintenance.repairMissingDefaultVariantsForCatalog(
			mustCatalogId()
		)
	}

	async diagnoseDefaultVariantsForCurrentCatalog(sampleLimit?: number) {
		return this.maintenance.diagnoseDefaultVariantsForCatalog(
			mustCatalogId(),
			sampleLimit
		)
	}

	async repairDefaultVariantPriceMismatchesForCurrentCatalog(
		options?: ProductDefaultVariantPriceMismatchRepairOptions
	) {
		assertCurrentCatalogCanManageCatalogContent()
		return this.maintenance.repairDefaultVariantPriceMismatchesForCatalog(
			mustCatalogId(),
			options
		)
	}

	async repairMissingDefaultVariantsForCatalog(catalogId: string) {
		return this.maintenance.repairMissingDefaultVariantsForCatalog(catalogId)
	}

	async diagnoseDefaultVariantsForCatalog(
		catalogId: string,
		sampleLimit?: number
	) {
		return this.maintenance.diagnoseDefaultVariantsForCatalog(
			catalogId,
			sampleLimit
		)
	}

	async repairDefaultVariantPriceMismatchesForCatalog(
		catalogId: string,
		options?: ProductDefaultVariantPriceMismatchRepairOptions
	) {
		return this.maintenance.repairDefaultVariantPriceMismatchesForCatalog(
			catalogId,
			options
		)
	}

	async rebuildSeoForCatalog(catalogId: string) {
		return this.maintenance.rebuildSeoForCatalog(catalogId)
	}
}
