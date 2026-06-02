import { Role } from '@generated/client'
import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	ParseUUIDPipe,
	Patch,
	Post,
	Query,
	Req,
	UploadedFile,
	UseGuards,
	UseInterceptors
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import {
	ApiBody,
	ApiConsumes,
	ApiCreatedResponse,
	ApiOkResponse,
	ApiOperation,
	ApiSecurity,
	ApiTags
} from '@nestjs/swagger'

import {
	ProductDefaultVariantDiagnosticsResponseDto,
	ProductDefaultVariantPriceMismatchRepairResponseDto,
	ProductDefaultVariantRepairResponseDto,
	RepairDefaultVariantPriceMismatchDtoReq
} from '@/modules/product/public'
import { DomainEventOutboxDiagnosticsService } from '@/shared/domain-events/domain-event-outbox-diagnostics.service'
import { SkipCatalog } from '@/shared/tenancy/decorators/skip-catalog.decorator'

import { Roles } from '../auth/decorators/roles.decorator'
import { SessionGuard } from '../auth/guards/session.guard'
import type { AuthRequest } from '../auth/types/auth-request'

import { AdminService, type UploadedPaymentProofFile } from './admin.service'
import {
	AdminActivityListItemDto,
	AdminCatalogFeatureEntitlementsDto,
	AdminCatalogListItemDto,
	AdminCountryListItemDto,
	AdminCreateCatalogResponseDto,
	AdminCreateGeoAdminResponseDto,
	AdminDeleteCatalogContentResultDto,
	AdminGeoAdminListItemDto,
	AdminMoySkladStockDiagnosticsReportDto,
	AdminPaymentDto,
	AdminPromoCodeListItemDto,
	AdminRegionalityListItemDto,
	AdminTypeListItemDto
} from './dto/admin-list.dto.res'
import { AdminCatalogsQueryDtoReq } from './dto/requests/admin-catalogs-query.dto.req'
import { AdminCreateActivityDtoReq } from './dto/requests/admin-create-activity.dto.req'
import { AdminCreateCatalogDtoReq } from './dto/requests/admin-create-catalog.dto.req'
import { AdminCreateCountryDtoReq } from './dto/requests/admin-create-country.dto.req'
import { AdminCreateGeoAdminDtoReq } from './dto/requests/admin-create-geo-admin.dto.req'
import { AdminCreatePromoCodeDtoReq } from './dto/requests/admin-create-promo-code.dto.req'
import { AdminCreateRegionalityDtoReq } from './dto/requests/admin-create-regionality.dto.req'
import { AdminCreatePromoPaymentDtoReq } from './dto/requests/admin-create-promo-payment.dto.req'
import { AdminCreateSubscriptionPaymentDtoReq } from './dto/requests/admin-create-subscription-payment.dto.req'
import { AdminDefaultVariantDiagnosticsQueryDtoReq } from './dto/requests/admin-default-variant-maintenance.dto.req'
import {
	AdminCleanupDomainEventOutboxDtoReq,
	AdminDomainEventOutboxQueryDtoReq,
	AdminDrainDomainEventOutboxDtoReq,
	AdminRetryFailedDomainEventsDtoReq
} from './dto/requests/admin-domain-event-outbox-query.dto.req'
import { AdminDuplicateCatalogDtoReq } from './dto/requests/admin-duplicate-catalog.dto.req'
import { AdminUpdateCatalogFeatureEntitlementDtoReq } from './dto/requests/admin-update-catalog-feature-entitlement.dto.req'
import { AdminUpdateCatalogDtoReq } from './dto/requests/admin-update-catalog.dto.req'
import {
	AdminDomainEventOutboxActionResultDto,
	AdminDomainEventOutboxCleanupResultDto,
	AdminDomainEventOutboxListDto,
	AdminDomainEventOutboxStatsDto
} from './dto/responses/admin-domain-event-outbox.dto.res'

const MAX_PAYMENT_PROOF_FILE_BYTES = 10 * 1024 * 1024

@ApiTags('Admin')
@ApiSecurity('csrf')
@SkipCatalog()
@UseGuards(SessionGuard)
@Roles(Role.GEO_ADMIN)
@Controller('/admin')
export class AdminController {
	constructor(
		private readonly adminService: AdminService,
		private readonly domainEventOutbox: DomainEventOutboxDiagnosticsService
	) {}

	@Get('/domain-events/outbox')
	@Roles(Role.ADMIN)
	@ApiOperation({ summary: 'List domain event outbox rows' })
	@ApiOkResponse({ type: AdminDomainEventOutboxListDto })
	async getDomainEventOutbox(
		@Query() query: AdminDomainEventOutboxQueryDtoReq
	): Promise<AdminDomainEventOutboxListDto> {
		return this.domainEventOutbox.list(query)
	}

	@Get('/domain-events/outbox/stats')
	@Roles(Role.ADMIN)
	@ApiOperation({ summary: 'Get domain event outbox status counters' })
	@ApiOkResponse({ type: AdminDomainEventOutboxStatsDto })
	async getDomainEventOutboxStats(): Promise<AdminDomainEventOutboxStatsDto> {
		return this.domainEventOutbox.stats()
	}

	@Post('/domain-events/outbox/:id/retry')
	@Roles(Role.ADMIN)
	@ApiOperation({ summary: 'Retry one pending or failed domain event' })
	@ApiOkResponse({ type: AdminDomainEventOutboxActionResultDto })
	async retryDomainEventOutboxItem(
		@Param('id', ParseUUIDPipe) id: string
	): Promise<AdminDomainEventOutboxActionResultDto> {
		return this.domainEventOutbox.retryOne(id)
	}

	@Post('/domain-events/outbox/retry-failed')
	@Roles(Role.ADMIN)
	@ApiOperation({ summary: 'Retry failed domain events by optional filters' })
	@ApiOkResponse({ type: AdminDomainEventOutboxActionResultDto })
	async retryFailedDomainEvents(
		@Body() dto: AdminRetryFailedDomainEventsDtoReq
	): Promise<AdminDomainEventOutboxActionResultDto> {
		return this.domainEventOutbox.retryFailed(dto)
	}

	@Post('/domain-events/outbox/drain')
	@Roles(Role.ADMIN)
	@ApiOperation({ summary: 'Manually drain pending/failed domain events' })
	@ApiOkResponse({ type: AdminDomainEventOutboxActionResultDto })
	async drainDomainEventOutbox(
		@Body() dto: AdminDrainDomainEventOutboxDtoReq
	): Promise<AdminDomainEventOutboxActionResultDto> {
		return this.domainEventOutbox.drainPending(dto)
	}

	@Post('/domain-events/outbox/cleanup')
	@Roles(Role.ADMIN)
	@ApiOperation({ summary: 'Delete old processed domain events' })
	@ApiOkResponse({ type: AdminDomainEventOutboxCleanupResultDto })
	async cleanupDomainEventOutbox(
		@Body() dto: AdminCleanupDomainEventOutboxDtoReq
	): Promise<AdminDomainEventOutboxCleanupResultDto> {
		return this.domainEventOutbox.cleanupProcessed(dto)
	}

	@Get('/catalogs')
	@ApiOperation({ summary: 'Получить список каталогов для админки' })
	@ApiOkResponse({ type: AdminCatalogListItemDto, isArray: true })
	async getCatalogs(
		@Query() query: AdminCatalogsQueryDtoReq,
		@Req() req: AuthRequest
	): Promise<AdminCatalogListItemDto[]> {
		return this.adminService.getCatalogs(query, getAdminActor(req)) as Promise<
			AdminCatalogListItemDto[]
		>
	}

	@Post('/catalogs')
	@ApiOperation({ summary: 'Create catalog with generated owner credentials' })
	@ApiCreatedResponse({ type: AdminCreateCatalogResponseDto })
	async createCatalog(
		@Body() dto: AdminCreateCatalogDtoReq,
		@Req() req: AuthRequest
	): Promise<AdminCreateCatalogResponseDto> {
		return this.adminService.createCatalog(
			dto,
			getAdminActor(req)
		) as Promise<AdminCreateCatalogResponseDto>
	}

	@Post('/catalogs/:id/duplicate')
	@ApiOperation({
		summary: 'Duplicate catalog with generated owner credentials'
	})
	@ApiCreatedResponse({ type: AdminCreateCatalogResponseDto })
	async duplicateCatalog(
		@Param('id', ParseUUIDPipe) id: string,
		@Body() dto: AdminDuplicateCatalogDtoReq,
		@Req() req: AuthRequest
	): Promise<AdminCreateCatalogResponseDto> {
		return this.adminService.duplicateCatalog(
			id,
			dto,
			getAdminActor(req)
		) as Promise<AdminCreateCatalogResponseDto>
	}

	@Post('/catalogs/:id/owner-password/reset')
	@ApiOperation({
		summary: 'Reset catalog owner password to default and return credentials'
	})
	@ApiOkResponse({ type: AdminCreateCatalogResponseDto })
	async resetCatalogOwnerPassword(
		@Param('id', ParseUUIDPipe) id: string,
		@Req() req: AuthRequest
	): Promise<AdminCreateCatalogResponseDto> {
		return this.adminService.resetCatalogOwnerPassword(
			id,
			getAdminActor(req)
		) as Promise<AdminCreateCatalogResponseDto>
	}

	@Patch('/catalogs/:id')
	@ApiOperation({ summary: 'Редактировать каталог' })
	@ApiOkResponse({ type: AdminCatalogListItemDto })
	async updateCatalog(
		@Param('id', ParseUUIDPipe) id: string,
		@Body() dto: AdminUpdateCatalogDtoReq,
		@Req() req: AuthRequest
	): Promise<AdminCatalogListItemDto> {
		return this.adminService.updateCatalog(
			id,
			dto,
			getAdminActor(req)
		) as Promise<AdminCatalogListItemDto>
	}

	@Get('/catalogs/:id/features')
	@ApiOperation({ summary: 'Get catalog feature entitlements' })
	@ApiOkResponse({ type: AdminCatalogFeatureEntitlementsDto })
	async getCatalogFeatureEntitlements(
		@Param('id', ParseUUIDPipe) id: string,
		@Req() req: AuthRequest
	): Promise<AdminCatalogFeatureEntitlementsDto> {
		return this.adminService.getCatalogFeatureEntitlements(
			id,
			getAdminActor(req)
		)
	}

	@Get('/catalogs/:id/maintenance/default-variants/diagnostics')
	@ApiOperation({
		summary: 'Diagnose legacy default variant consistency for catalog'
	})
	@ApiOkResponse({ type: ProductDefaultVariantDiagnosticsResponseDto })
	async diagnoseCatalogDefaultVariants(
		@Param('id', ParseUUIDPipe) id: string,
		@Query() query: AdminDefaultVariantDiagnosticsQueryDtoReq,
		@Req() req: AuthRequest
	): Promise<ProductDefaultVariantDiagnosticsResponseDto> {
		return this.adminService.diagnoseCatalogDefaultVariants(
			id,
			query.sampleLimit,
			getAdminActor(req)
		) as Promise<ProductDefaultVariantDiagnosticsResponseDto>
	}

	@Post('/catalogs/:id/maintenance/default-variants/repair')
	@ApiOperation({
		summary: 'Repair missing technical default variants for catalog'
	})
	@ApiOkResponse({ type: ProductDefaultVariantRepairResponseDto })
	async repairCatalogMissingDefaultVariants(
		@Param('id', ParseUUIDPipe) id: string,
		@Req() req: AuthRequest
	): Promise<ProductDefaultVariantRepairResponseDto> {
		return this.adminService.repairCatalogMissingDefaultVariants(
			id,
			getAdminActor(req)
		) as Promise<ProductDefaultVariantRepairResponseDto>
	}

	@Post('/catalogs/:id/maintenance/default-variants/price-mismatches/repair')
	@ApiOperation({
		summary: 'Dry-run or repair legacy product price mirror mismatches'
	})
	@ApiOkResponse({ type: ProductDefaultVariantPriceMismatchRepairResponseDto })
	async repairCatalogDefaultVariantPriceMismatches(
		@Param('id', ParseUUIDPipe) id: string,
		@Body() dto: RepairDefaultVariantPriceMismatchDtoReq,
		@Req() req: AuthRequest
	): Promise<ProductDefaultVariantPriceMismatchRepairResponseDto> {
		return this.adminService.repairCatalogDefaultVariantPriceMismatches(
			id,
			dto,
			getAdminActor(req)
		) as Promise<ProductDefaultVariantPriceMismatchRepairResponseDto>
	}

	@Get('/catalogs/:id/integrations/moysklad/stock-diagnostics')
	@ApiOperation({ summary: 'Get MoySklad stock sync diagnostics for catalog' })
	@ApiOkResponse({ type: AdminMoySkladStockDiagnosticsReportDto })
	async getCatalogMoySkladStockDiagnostics(
		@Param('id', ParseUUIDPipe) id: string,
		@Req() req: AuthRequest
	): Promise<AdminMoySkladStockDiagnosticsReportDto> {
		return this.adminService.getCatalogMoySkladStockDiagnostics(
			id,
			getAdminActor(req)
		) as Promise<AdminMoySkladStockDiagnosticsReportDto>
	}

	@Patch('/catalogs/:id/features')
	@ApiOperation({ summary: 'Enable or disable a catalog feature entitlement' })
	@ApiOkResponse({ type: AdminCatalogFeatureEntitlementsDto })
	async updateCatalogFeatureEntitlement(
		@Param('id', ParseUUIDPipe) id: string,
		@Body() dto: AdminUpdateCatalogFeatureEntitlementDtoReq,
		@Req() req: AuthRequest
	): Promise<AdminCatalogFeatureEntitlementsDto> {
		return this.adminService.updateCatalogFeatureEntitlement(
			id,
			dto,
			getAdminActor(req)
		)
	}

	@Delete('/catalogs/:id')
	@ApiOperation({ summary: 'Удалить каталог через soft-delete' })
	@ApiOkResponse({ type: AdminCatalogListItemDto })
	async deleteCatalog(
		@Param('id', ParseUUIDPipe) id: string,
		@Req() req: AuthRequest
	): Promise<AdminCatalogListItemDto> {
		return this.adminService.deleteCatalog(
			id,
			getAdminActor(req)
		) as Promise<AdminCatalogListItemDto>
	}

	@Delete('/catalogs/:id/content')
	@ApiOperation({ summary: 'Soft-delete контент каталога, не удаляя каталог' })
	@ApiOkResponse({ type: AdminDeleteCatalogContentResultDto })
	async deleteCatalogContent(
		@Param('id', ParseUUIDPipe) id: string,
		@Req() req: AuthRequest
	): Promise<AdminDeleteCatalogContentResultDto> {
		return this.adminService.deleteCatalogContent(
			id,
			getAdminActor(req)
		) as Promise<AdminDeleteCatalogContentResultDto>
	}

	@Post('/catalogs/:id/restore')
	@ApiOperation({ summary: 'Восстановить soft-deleted каталог' })
	@ApiOkResponse({ type: AdminCatalogListItemDto })
	async restoreCatalog(
		@Param('id', ParseUUIDPipe) id: string,
		@Req() req: AuthRequest
	): Promise<AdminCatalogListItemDto> {
		return this.adminService.restoreCatalog(
			id,
			getAdminActor(req)
		) as Promise<AdminCatalogListItemDto>
	}

	@Get('/types')
	@ApiOperation({ summary: 'Получить список типов каталогов для админки' })
	@ApiOkResponse({ type: AdminTypeListItemDto, isArray: true })
	async getTypes(): Promise<AdminTypeListItemDto[]> {
		return this.adminService.getTypes() as Promise<AdminTypeListItemDto[]>
	}

	@Get('/geo-admins')
	@Roles(Role.ADMIN)
	@ApiOperation({ summary: 'List geo admins with assigned countries and regions' })
	@ApiOkResponse({ type: AdminGeoAdminListItemDto, isArray: true })
	async getGeoAdmins(
		@Req() req: AuthRequest
	): Promise<AdminGeoAdminListItemDto[]> {
		return this.adminService.getGeoAdmins(getAdminActor(req)) as Promise<
			AdminGeoAdminListItemDto[]
		>
	}

	@Post('/geo-admins')
	@Roles(Role.ADMIN)
	@ApiOperation({ summary: 'Create geo admin with assigned countries and regions' })
	@ApiCreatedResponse({ type: AdminCreateGeoAdminResponseDto })
	async createGeoAdmin(
		@Body() dto: AdminCreateGeoAdminDtoReq,
		@Req() req: AuthRequest
	): Promise<AdminCreateGeoAdminResponseDto> {
		return this.adminService.createGeoAdmin(
			dto,
			getAdminActor(req)
		) as Promise<AdminCreateGeoAdminResponseDto>
	}

	@Get('/regionalities')
	@ApiOperation({
		summary: 'Get country and region directory for admin catalog binding'
	})
	@ApiOkResponse({ type: AdminRegionalityListItemDto, isArray: true })
	async getRegionalities(
		@Req() req: AuthRequest
	): Promise<AdminRegionalityListItemDto[]> {
		return this.adminService.getRegionalities(getAdminActor(req)) as Promise<
			AdminRegionalityListItemDto[]
		>
	}

	@Get('/countries')
	@ApiOperation({ summary: 'Get country directory for admin catalog binding' })
	@ApiOkResponse({ type: AdminCountryListItemDto, isArray: true })
	async getCountries(@Req() req: AuthRequest): Promise<AdminCountryListItemDto[]> {
		return this.adminService.getCountries(getAdminActor(req)) as Promise<
			AdminCountryListItemDto[]
		>
	}

	@Post('/countries')
	@ApiOperation({ summary: 'Create country for admin catalog binding' })
	@ApiCreatedResponse({ type: AdminCountryListItemDto })
	async createCountry(
		@Body() dto: AdminCreateCountryDtoReq,
		@Req() req: AuthRequest
	): Promise<AdminCountryListItemDto> {
		return this.adminService.createCountry(
			dto,
			getAdminActor(req)
		) as Promise<AdminCountryListItemDto>
	}

	@Post('/regionalities')
	@ApiOperation({ summary: 'Create country and region for admin catalog binding' })
	@ApiCreatedResponse({ type: AdminRegionalityListItemDto })
	async createRegionality(
		@Body() dto: AdminCreateRegionalityDtoReq,
		@Req() req: AuthRequest
	): Promise<AdminRegionalityListItemDto> {
		return this.adminService.createRegionality(
			dto,
			getAdminActor(req)
		) as Promise<AdminRegionalityListItemDto>
	}

	@Get('/activities')
	@ApiOperation({ summary: 'Получить список родов деятельности для админки' })
	@ApiOkResponse({ type: AdminActivityListItemDto, isArray: true })
	async getActivities(
		@Query('typeId') typeId?: string
	): Promise<AdminActivityListItemDto[]> {
		return this.adminService.getActivities(typeId) as Promise<
			AdminActivityListItemDto[]
		>
	}

	@Post('/activities')
	@ApiOperation({ summary: 'Создать род деятельности' })
	@ApiCreatedResponse({ type: AdminActivityListItemDto })
	async createActivity(
		@Body() dto: AdminCreateActivityDtoReq
	): Promise<AdminActivityListItemDto> {
		return this.adminService.createActivity(
			dto
		) as Promise<AdminActivityListItemDto>
	}

	@Get('/promo-codes')
	@ApiOperation({ summary: 'Получить список промокодов для админки' })
	@ApiOkResponse({ type: AdminPromoCodeListItemDto, isArray: true })
	async getPromoCodes(): Promise<AdminPromoCodeListItemDto[]> {
		return this.adminService.getPromoCodes() as Promise<
			AdminPromoCodeListItemDto[]
		>
	}

	@Post('/promo-codes')
	@ApiOperation({ summary: 'Создать промокод' })
	@ApiCreatedResponse({ type: AdminPromoCodeListItemDto })
	async createPromoCode(
		@Body() dto: AdminCreatePromoCodeDtoReq
	): Promise<AdminPromoCodeListItemDto> {
		return this.adminService.createPromoCode(
			dto
		) as Promise<AdminPromoCodeListItemDto>
	}

	@Get('/catalogs/:id/payments')
	@ApiOperation({ summary: 'Получить список оплат каталога' })
	@ApiOkResponse({ type: AdminPaymentDto, isArray: true })
	async getCatalogPayments(
		@Param('id', ParseUUIDPipe) id: string,
		@Req() req: AuthRequest
	): Promise<AdminPaymentDto[]> {
		return this.adminService.getCatalogPayments(
			id,
			getAdminActor(req)
		) as Promise<AdminPaymentDto[]>
	}

	@Get('/promo-codes/:id/payments')
	@ApiOperation({ summary: 'Получить список оплат промокода' })
	@ApiOkResponse({ type: AdminPaymentDto, isArray: true })
	async getPromoCodePayments(
		@Param('id', ParseUUIDPipe) id: string
	): Promise<AdminPaymentDto[]> {
		return this.adminService.getPromoCodePayments(id) as Promise<
			AdminPaymentDto[]
		>
	}

	@Post('/catalogs/:id/promo-payments')
	@ApiOperation({ summary: 'Создать оплату промокода для каталога' })
	@ApiConsumes('multipart/form-data')
	@ApiBody({
		schema: {
			type: 'object',
			required: ['promoCodeId', 'proof'],
			properties: {
				promoCodeId: { type: 'string', format: 'uuid' },
				amount: { type: 'number', example: 1000 },
				paidAt: { type: 'string', format: 'date-time' },
				licenseEndsAt: { type: 'string', format: 'date-time' },
				proof: {
					type: 'string',
					format: 'binary',
					description: 'PDF, JPEG, PNG or WebP payment confirmation'
				}
			}
		}
	})
	@ApiCreatedResponse({ type: AdminPaymentDto })
	@UseInterceptors(
		FileInterceptor('proof', {
			limits: { fileSize: MAX_PAYMENT_PROOF_FILE_BYTES }
		})
	)
	async createCatalogPromoPayment(
		@Param('id', ParseUUIDPipe) id: string,
		@Body() dto: AdminCreatePromoPaymentDtoReq,
		@UploadedFile() proof: UploadedPaymentProofFile | undefined,
		@Req() req: AuthRequest
	): Promise<AdminPaymentDto> {
		return this.adminService.createCatalogPromoPayment(
			id,
			dto,
			proof,
			getAdminActor(req)
		) as Promise<AdminPaymentDto>
	}

	@Post('/catalogs/:id/subscription-payments')
	@ApiOperation({ summary: 'Создать оплату подписки для каталога' })
	@ApiConsumes('multipart/form-data')
	@ApiBody({
		schema: {
			type: 'object',
			required: ['proof'],
			properties: {
				amount: { type: 'number', example: 1000 },
				paidAt: { type: 'string', format: 'date-time' },
				licenseEndsAt: { type: 'string', format: 'date-time' },
				proof: {
					type: 'string',
					format: 'binary',
					description: 'PDF, JPEG, PNG or WebP payment confirmation'
				}
			}
		}
	})
	@ApiCreatedResponse({ type: AdminPaymentDto })
	@UseInterceptors(
		FileInterceptor('proof', {
			limits: { fileSize: MAX_PAYMENT_PROOF_FILE_BYTES }
		})
	)
	async createCatalogSubscriptionPayment(
		@Param('id', ParseUUIDPipe) id: string,
		@Body() dto: AdminCreateSubscriptionPaymentDtoReq,
		@UploadedFile() proof: UploadedPaymentProofFile | undefined,
		@Req() req: AuthRequest
	): Promise<AdminPaymentDto> {
		return this.adminService.createCatalogSubscriptionPayment(
			id,
			dto,
			proof,
			getAdminActor(req)
		) as Promise<AdminPaymentDto>
	}
}

function getAdminActor(req: AuthRequest) {
	if (!req.user) throw new Error('Missing authenticated user')
	return {
		id: req.user.id,
		role: req.user.role
	}
}
