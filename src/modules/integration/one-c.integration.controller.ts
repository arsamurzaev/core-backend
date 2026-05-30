import { Role } from '@generated/enums'
import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Patch,
	Post,
	Put,
	Query,
	UseGuards
} from '@nestjs/common'
import {
	ApiOkResponse,
	ApiOperation,
	ApiParam,
	ApiQuery,
	ApiSecurity,
	ApiTags
} from '@nestjs/swagger'

import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'
import { mustCatalogId } from '@/shared/tenancy/ctx'

import { Roles } from '../auth/decorators/roles.decorator'
import { CatalogAccessGuard } from '../auth/guards/catalog-access.guard'
import { SessionGuard } from '../auth/guards/session.guard'

import {
	ApplyOneCPriceSyncDtoReq,
	ApplyOneCStockSyncDtoReq,
	CreateOneCEntityMappingDtoReq,
	CreateOneCExternalObjectDtoReq,
	CreateOneCFieldMappingDtoReq,
	DiscoverOneCObjectsDtoReq,
	ImportOneCProductsDtoReq,
	ImportOneCVariantsDtoReq,
	PreviewOneCMappingDtoReq,
	PreviewOneCPriceSyncDtoReq,
	PreviewOneCProductImportDtoReq,
	PreviewOneCRemoteMappingDtoReq,
	PreviewOneCStockSyncDtoReq,
	PreviewOneCVariantImportDtoReq,
	RunOneCPriceSyncDtoReq,
	RunOneCProductSyncDtoReq,
	RunOneCStockSyncDtoReq,
	RunOneCVariantSyncDtoReq,
	TestOneCConnectionDtoReq,
	UpdateOneCEntityMappingDtoReq,
	UpdateOneCExternalObjectDtoReq,
	UpdateOneCFieldMappingDtoReq,
	UpdateOneCIntegrationDtoReq,
	UpsertOneCIntegrationDtoReq
} from './dto/requests/one-c-integration.dto.req'
import {
	OneCDiscoverObjectsDto,
	OneCEntityMappingDto,
	OneCExternalObjectDto,
	OneCFieldMappingDto,
	OneCIntegrationDto,
	OneCIntegrationStatusDto,
	OneCMappingPreviewDto,
	OneCPriceSyncPreviewDto,
	OneCPriceSyncResultDto,
	OneCProductImportPreviewDto,
	OneCProductImportResultDto,
	OneCQueuedSyncDto,
	OneCRecommendedPriceMappingDto,
	OneCRecommendedProductMappingDto,
	OneCRecommendedStockMappingDto,
	OneCRecommendedVariantMappingDto,
	OneCRemoteMappingPreviewDto,
	OneCStockSyncPreviewDto,
	OneCStockSyncResultDto,
	OneCSyncProgressDto,
	OneCSyncRunDto,
	OneCTestConnectionDto,
	OneCVariantImportPreviewDto,
	OneCVariantImportResultDto
} from './dto/responses/one-c.dto.res'
import { OneCIntegrationService } from './providers/one-c/one-c.integration.service'
import { OneCQueueService } from './providers/one-c/one-c.queue.service'

@ApiTags('Integration')
@Controller('integration/1c')
@ApiSecurity('csrf')
@UseGuards(SessionGuard, CatalogAccessGuard)
@Roles(Role.CATALOG)
export class OneCIntegrationController {
	constructor(
		private readonly oneC: OneCIntegrationService,
		private readonly oneCQueue: OneCQueueService
	) {}

	@Get()
	@ApiOperation({ summary: 'Get ONE_C integration settings' })
	@ApiOkResponse({ type: OneCIntegrationDto })
	async getOneC() {
		return this.oneC.get()
	}

	@Get('status')
	@ApiOperation({ summary: 'Get ONE_C integration status' })
	@ApiOkResponse({ type: OneCIntegrationStatusDto })
	async getOneCStatus() {
		return this.oneC.getStatus()
	}

	@Get('runs')
	@ApiOperation({ summary: 'Get ONE_C sync history' })
	@ApiQuery({
		name: 'limit',
		required: false,
		type: Number,
		description: 'How many recent sync runs to return'
	})
	@ApiOkResponse({ type: OneCSyncRunDto, isArray: true })
	async getOneCRuns(@Query('limit') limit?: number | string) {
		return this.oneC.listRuns(limit)
	}

	@Get('runs/:runId/progress')
	@ApiOperation({ summary: 'Get ONE_C sync progress' })
	@ApiParam({ name: 'runId' })
	@ApiOkResponse({ type: OneCSyncProgressDto })
	async getOneCRunProgress(@Param('runId') runId: string) {
		return this.oneC.getRunProgress(runId)
	}

	@Get('product-mapping-default')
	@ApiOperation({ summary: 'Get recommended ONE_C PRODUCT mapping' })
	@ApiOkResponse({ type: OneCRecommendedProductMappingDto })
	async getOneCRecommendedProductMapping() {
		return this.oneC.getRecommendedProductMapping()
	}

	@Get('variant-mapping-default')
	@ApiOperation({ summary: 'Get recommended ONE_C PRODUCT_VARIANT mapping' })
	@ApiOkResponse({ type: OneCRecommendedVariantMappingDto })
	async getOneCRecommendedVariantMapping() {
		return this.oneC.getRecommendedVariantMapping()
	}

	@Get('stock-mapping-default')
	@ApiOperation({ summary: 'Get recommended ONE_C STOCK mapping' })
	@ApiOkResponse({ type: OneCRecommendedStockMappingDto })
	async getOneCRecommendedStockMapping() {
		return this.oneC.getRecommendedStockMapping()
	}

	@Get('price-mapping-default')
	@ApiOperation({ summary: 'Get recommended ONE_C PRICE mapping' })
	@ApiOkResponse({ type: OneCRecommendedPriceMappingDto })
	async getOneCRecommendedPriceMapping() {
		return this.oneC.getRecommendedPriceMapping()
	}

	@Put()
	@ApiOperation({ summary: 'Create or replace ONE_C integration settings' })
	@ApiOkResponse({ type: OneCIntegrationDto })
	async upsertOneC(@Body() dto: UpsertOneCIntegrationDtoReq) {
		const integration = await this.oneC.upsert(dto)
		await this.oneCQueue.syncSchedulerForCatalog(mustCatalogId())
		return integration
	}

	@Patch()
	@ApiOperation({ summary: 'Update ONE_C integration settings' })
	@ApiOkResponse({ type: OneCIntegrationDto })
	async updateOneC(@Body() dto: UpdateOneCIntegrationDtoReq) {
		const integration = await this.oneC.update(dto)
		await this.oneCQueue.syncSchedulerForCatalog(mustCatalogId())
		return integration
	}

	@Delete()
	@ApiOperation({ summary: 'Remove ONE_C integration settings' })
	@ApiOkResponse({ type: OkResponseDto })
	async removeOneC() {
		const catalogId = mustCatalogId()
		const result = await this.oneC.remove()
		await this.oneCQueue.removeScheduler(catalogId)
		return result
	}

	@Post('test-connection')
	@ApiOperation({ summary: 'Test ONE_C API connection' })
	@ApiOkResponse({ type: OneCTestConnectionDto })
	async testOneCConnection(@Body() dto: TestOneCConnectionDtoReq = {}) {
		return this.oneC.testConnection(dto)
	}

	@Post('discover')
	@ApiOperation({ summary: 'Discover ONE_C OData objects and fields' })
	@ApiOkResponse({ type: OneCDiscoverObjectsDto })
	async discoverOneCObjects(@Body() dto: DiscoverOneCObjectsDtoReq = {}) {
		return this.oneC.discoverObjects(dto)
	}

	@Get('objects')
	@ApiOperation({ summary: 'List configured ONE_C external objects' })
	@ApiOkResponse({ type: OneCExternalObjectDto, isArray: true })
	async listOneCObjects() {
		return this.oneC.listExternalObjects()
	}

	@Post('objects')
	@ApiOperation({ summary: 'Create or update ONE_C external object' })
	@ApiOkResponse({ type: OneCExternalObjectDto })
	async createOneCObject(@Body() dto: CreateOneCExternalObjectDtoReq) {
		return this.oneC.createExternalObject(dto)
	}

	@Patch('objects/:id')
	@ApiOperation({ summary: 'Update ONE_C external object' })
	@ApiParam({ name: 'id' })
	@ApiOkResponse({ type: OneCExternalObjectDto })
	async updateOneCObject(
		@Param('id') id: string,
		@Body() dto: UpdateOneCExternalObjectDtoReq
	) {
		return this.oneC.updateExternalObject(id, dto)
	}

	@Delete('objects/:id')
	@ApiOperation({ summary: 'Delete ONE_C external object' })
	@ApiParam({ name: 'id' })
	@ApiOkResponse({ type: OkResponseDto })
	async deleteOneCObject(@Param('id') id: string) {
		return this.oneC.deleteExternalObject(id)
	}

	@Get('entity-mappings')
	@ApiOperation({ summary: 'List ONE_C entity mappings' })
	@ApiOkResponse({ type: OneCEntityMappingDto, isArray: true })
	async listOneCEntityMappings() {
		return this.oneC.listEntityMappings()
	}

	@Post('entity-mappings')
	@ApiOperation({ summary: 'Create ONE_C entity mapping' })
	@ApiOkResponse({ type: OneCEntityMappingDto })
	async createOneCEntityMapping(@Body() dto: CreateOneCEntityMappingDtoReq) {
		return this.oneC.createEntityMapping(dto)
	}

	@Patch('entity-mappings/:id')
	@ApiOperation({ summary: 'Update ONE_C entity mapping' })
	@ApiParam({ name: 'id' })
	@ApiOkResponse({ type: OneCEntityMappingDto })
	async updateOneCEntityMapping(
		@Param('id') id: string,
		@Body() dto: UpdateOneCEntityMappingDtoReq
	) {
		return this.oneC.updateEntityMapping(id, dto)
	}

	@Delete('entity-mappings/:id')
	@ApiOperation({ summary: 'Delete ONE_C entity mapping' })
	@ApiParam({ name: 'id' })
	@ApiOkResponse({ type: OkResponseDto })
	async deleteOneCEntityMapping(@Param('id') id: string) {
		return this.oneC.deleteEntityMapping(id)
	}

	@Post('entity-mappings/:id/field-mappings')
	@ApiOperation({ summary: 'Create ONE_C field mapping' })
	@ApiParam({ name: 'id' })
	@ApiOkResponse({ type: OneCFieldMappingDto })
	async createOneCFieldMapping(
		@Param('id') id: string,
		@Body() dto: CreateOneCFieldMappingDtoReq
	) {
		return this.oneC.createFieldMapping(id, dto)
	}

	@Patch('field-mappings/:id')
	@ApiOperation({ summary: 'Update ONE_C field mapping' })
	@ApiParam({ name: 'id' })
	@ApiOkResponse({ type: OneCFieldMappingDto })
	async updateOneCFieldMapping(
		@Param('id') id: string,
		@Body() dto: UpdateOneCFieldMappingDtoReq
	) {
		return this.oneC.updateFieldMapping(id, dto)
	}

	@Delete('field-mappings/:id')
	@ApiOperation({ summary: 'Delete ONE_C field mapping' })
	@ApiParam({ name: 'id' })
	@ApiOkResponse({ type: OkResponseDto })
	async deleteOneCFieldMapping(@Param('id') id: string) {
		return this.oneC.deleteFieldMapping(id)
	}

	@Post('mapping-preview')
	@ApiOperation({
		summary: 'Preview ONE_C field mapping against a sample payload'
	})
	@ApiOkResponse({ type: OneCMappingPreviewDto })
	async previewOneCMapping(@Body() dto: PreviewOneCMappingDtoReq) {
		return this.oneC.previewMapping(dto)
	}

	@Post('remote-mapping-preview')
	@ApiOperation({
		summary: 'Fetch ONE_C rows and preview field mapping without writing locally'
	})
	@ApiOkResponse({ type: OneCRemoteMappingPreviewDto })
	async previewOneCRemoteMapping(@Body() dto: PreviewOneCRemoteMappingDtoReq) {
		return this.oneC.previewRemoteMapping(dto)
	}

	@Post('product-import-preview')
	@ApiOperation({
		summary: 'Build ONE_C product import dry-run plan without writing locally'
	})
	@ApiOkResponse({ type: OneCProductImportPreviewDto })
	async previewOneCProductImport(@Body() dto: PreviewOneCProductImportDtoReq) {
		return this.oneC.previewProductImport(dto)
	}

	@Post('import-products')
	@ApiOperation({
		summary: 'Import ONE_C products using configured field mapping'
	})
	@ApiOkResponse({ type: OneCProductImportResultDto })
	async importOneCProducts(@Body() dto: ImportOneCProductsDtoReq) {
		return this.oneC.importProducts(dto)
	}

	@Post('variant-import-preview')
	@ApiOperation({
		summary:
			'Build ONE_C product variant import dry-run plan without writing locally'
	})
	@ApiOkResponse({ type: OneCVariantImportPreviewDto })
	async previewOneCVariantImport(@Body() dto: PreviewOneCVariantImportDtoReq) {
		return this.oneC.previewVariantImport(dto)
	}

	@Post('import-variants')
	@ApiOperation({
		summary: 'Import ONE_C product variants using configured field mapping'
	})
	@ApiOkResponse({ type: OneCVariantImportResultDto })
	async importOneCVariants(@Body() dto: ImportOneCVariantsDtoReq) {
		return this.oneC.importVariants(dto)
	}

	@Post('stock-sync-preview')
	@ApiOperation({
		summary: 'Build ONE_C stock sync dry-run plan without writing locally'
	})
	@ApiOkResponse({ type: OneCStockSyncPreviewDto })
	async previewOneCStockSync(@Body() dto: PreviewOneCStockSyncDtoReq) {
		return this.oneC.previewStockSync(dto)
	}

	@Post('apply-stock')
	@ApiOperation({
		summary: 'Apply ONE_C stock rows using configured field mapping'
	})
	@ApiOkResponse({ type: OneCStockSyncResultDto })
	async applyOneCStockSync(@Body() dto: ApplyOneCStockSyncDtoReq) {
		return this.oneC.applyStockSync(dto)
	}

	@Post('price-sync-preview')
	@ApiOperation({
		summary: 'Build ONE_C price sync dry-run plan without writing locally'
	})
	@ApiOkResponse({ type: OneCPriceSyncPreviewDto })
	async previewOneCPriceSync(@Body() dto: PreviewOneCPriceSyncDtoReq) {
		return this.oneC.previewPriceSync(dto)
	}

	@Post('apply-prices')
	@ApiOperation({
		summary: 'Apply ONE_C price rows using configured field mapping'
	})
	@ApiOkResponse({ type: OneCPriceSyncResultDto })
	async applyOneCPriceSync(@Body() dto: ApplyOneCPriceSyncDtoReq) {
		return this.oneC.applyPriceSync(dto)
	}

	@Post('sync-products')
	@ApiOperation({
		summary: 'Queue managed ONE_C product sync and record sync history'
	})
	@ApiOkResponse({ type: OneCQueuedSyncDto })
	async syncOneCProducts(@Body() dto: RunOneCProductSyncDtoReq) {
		return this.oneCQueue.enqueueProductSync(mustCatalogId(), dto)
	}

	@Post('sync-variants')
	@ApiOperation({
		summary: 'Queue managed ONE_C product variant sync and record sync history'
	})
	@ApiOkResponse({ type: OneCQueuedSyncDto })
	async syncOneCVariants(@Body() dto: RunOneCVariantSyncDtoReq) {
		return this.oneCQueue.enqueueVariantSync(mustCatalogId(), dto)
	}

	@Post('sync-stock')
	@ApiOperation({
		summary: 'Queue managed ONE_C stock sync and record sync history'
	})
	@ApiOkResponse({ type: OneCQueuedSyncDto })
	async syncOneCStock(@Body() dto: RunOneCStockSyncDtoReq = {}) {
		return this.oneCQueue.enqueueStockSync(mustCatalogId(), dto)
	}

	@Post('sync-prices')
	@ApiOperation({
		summary: 'Queue managed ONE_C price sync and record sync history'
	})
	@ApiOkResponse({ type: OneCQueuedSyncDto })
	async syncOneCPrices(@Body() dto: RunOneCPriceSyncDtoReq = {}) {
		return this.oneCQueue.enqueuePriceSync(mustCatalogId(), dto)
	}
}
