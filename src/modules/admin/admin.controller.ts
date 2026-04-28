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

import { SkipCatalog } from '@/shared/tenancy/decorators/skip-catalog.decorator'

import { Roles } from '../auth/decorators/roles.decorator'
import { SessionGuard } from '../auth/guards/session.guard'

import { AdminService, type UploadedPaymentProofFile } from './admin.service'
import {
	AdminActivityListItemDto,
	AdminCatalogListItemDto,
	AdminCreateCatalogResponseDto,
	AdminPaymentDto,
	AdminPromoCodeListItemDto,
	AdminTypeListItemDto
} from './dto/admin-list.dto.res'
import { AdminCatalogsQueryDtoReq } from './dto/requests/admin-catalogs-query.dto.req'
import { AdminCreateActivityDtoReq } from './dto/requests/admin-create-activity.dto.req'
import { AdminCreateCatalogDtoReq } from './dto/requests/admin-create-catalog.dto.req'
import { AdminCreatePromoCodeDtoReq } from './dto/requests/admin-create-promo-code.dto.req'
import { AdminCreatePromoPaymentDtoReq } from './dto/requests/admin-create-promo-payment.dto.req'
import { AdminCreateSubscriptionPaymentDtoReq } from './dto/requests/admin-create-subscription-payment.dto.req'
import { AdminDuplicateCatalogDtoReq } from './dto/requests/admin-duplicate-catalog.dto.req'
import { AdminUpdateCatalogDtoReq } from './dto/requests/admin-update-catalog.dto.req'

const MAX_PAYMENT_PROOF_FILE_BYTES = 10 * 1024 * 1024

@ApiTags('Admin')
@ApiSecurity('csrf')
@SkipCatalog()
@UseGuards(SessionGuard)
@Roles(Role.ADMIN)
@Controller('/admin')
export class AdminController {
	constructor(private readonly adminService: AdminService) {}

	@Get('/catalogs')
	@ApiOperation({ summary: 'Получить список каталогов для админки' })
	@ApiOkResponse({ type: AdminCatalogListItemDto, isArray: true })
	async getCatalogs(
		@Query() query: AdminCatalogsQueryDtoReq
	): Promise<AdminCatalogListItemDto[]> {
		return this.adminService.getCatalogs(query) as Promise<
			AdminCatalogListItemDto[]
		>
	}

	@Post('/catalogs')
	@ApiOperation({ summary: 'Create catalog with generated owner credentials' })
	@ApiCreatedResponse({ type: AdminCreateCatalogResponseDto })
	async createCatalog(
		@Body() dto: AdminCreateCatalogDtoReq
	): Promise<AdminCreateCatalogResponseDto> {
		return this.adminService.createCatalog(
			dto
		) as Promise<AdminCreateCatalogResponseDto>
	}

	@Post('/catalogs/:id/duplicate')
	@ApiOperation({
		summary: 'Duplicate catalog with generated owner credentials'
	})
	@ApiCreatedResponse({ type: AdminCreateCatalogResponseDto })
	async duplicateCatalog(
		@Param('id', ParseUUIDPipe) id: string,
		@Body() dto: AdminDuplicateCatalogDtoReq
	): Promise<AdminCreateCatalogResponseDto> {
		return this.adminService.duplicateCatalog(
			id,
			dto
		) as Promise<AdminCreateCatalogResponseDto>
	}

	@Patch('/catalogs/:id')
	@ApiOperation({ summary: 'Редактировать каталог' })
	@ApiOkResponse({ type: AdminCatalogListItemDto })
	async updateCatalog(
		@Param('id', ParseUUIDPipe) id: string,
		@Body() dto: AdminUpdateCatalogDtoReq
	): Promise<AdminCatalogListItemDto> {
		return this.adminService.updateCatalog(
			id,
			dto
		) as Promise<AdminCatalogListItemDto>
	}

	@Delete('/catalogs/:id')
	@ApiOperation({ summary: 'Удалить каталог через soft-delete' })
	@ApiOkResponse({ type: AdminCatalogListItemDto })
	async deleteCatalog(
		@Param('id', ParseUUIDPipe) id: string
	): Promise<AdminCatalogListItemDto> {
		return this.adminService.deleteCatalog(id) as Promise<AdminCatalogListItemDto>
	}

	@Post('/catalogs/:id/restore')
	@ApiOperation({ summary: 'Восстановить soft-deleted каталог' })
	@ApiOkResponse({ type: AdminCatalogListItemDto })
	async restoreCatalog(
		@Param('id', ParseUUIDPipe) id: string
	): Promise<AdminCatalogListItemDto> {
		return this.adminService.restoreCatalog(
			id
		) as Promise<AdminCatalogListItemDto>
	}

	@Get('/types')
	@ApiOperation({ summary: 'Получить список типов каталогов для админки' })
	@ApiOkResponse({ type: AdminTypeListItemDto, isArray: true })
	async getTypes(): Promise<AdminTypeListItemDto[]> {
		return this.adminService.getTypes() as Promise<AdminTypeListItemDto[]>
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
		@Param('id', ParseUUIDPipe) id: string
	): Promise<AdminPaymentDto[]> {
		return this.adminService.getCatalogPayments(id) as Promise<AdminPaymentDto[]>
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
		@UploadedFile() proof?: UploadedPaymentProofFile
	): Promise<AdminPaymentDto> {
		return this.adminService.createCatalogPromoPayment(
			id,
			dto,
			proof
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
		@UploadedFile() proof?: UploadedPaymentProofFile
	): Promise<AdminPaymentDto> {
		return this.adminService.createCatalogSubscriptionPayment(
			id,
			dto,
			proof
		) as Promise<AdminPaymentDto>
	}
}
