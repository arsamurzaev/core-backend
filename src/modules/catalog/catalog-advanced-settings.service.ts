import { Metric, MetricScope } from '@generated/enums'
import {
	BadRequestException,
	Injectable,
	NotFoundException
} from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import {
	type ActiveSessionEntry,
	AuthService,
	AuthSessionDto,
	AuthSessionsResponseDto,
	ChangePasswordDtoReq,
	SessionService
} from '@/modules/auth/public'
import {
	CatalogSaleUnitService,
	CreateCatalogSaleUnitDtoReq,
	UpdateCatalogSaleUnitDtoReq
} from '@/modules/catalog-sale-unit/public'
import { IntegrationService } from '@/modules/integration/public'
import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'
import { mustCatalogId } from '@/shared/tenancy/ctx'

import { CatalogDomainService } from './catalog-domain.service'
import { CreateCatalogDomainDtoReq } from './dto/requests/create-catalog-domain.dto.req'
import { UpdateCatalogYandexMetrikaDtoReq } from './dto/requests/update-catalog-yandex-metrika.dto.req'
import {
	CatalogDomainCheckDto,
	CatalogDomainDto
} from './dto/responses/catalog-domain.dto.res'
import { CatalogYandexMetrikaDto } from './dto/responses/catalog-yandex-metrika.dto.res'

@Injectable()
export class CatalogAdvancedSettingsService {
	constructor(
		private readonly auth: AuthService,
		private readonly sessions: SessionService,
		private readonly domains: CatalogDomainService,
		private readonly integration: IntegrationService,
		private readonly saleUnits: CatalogSaleUnitService,
		private readonly prisma: PrismaService
	) {}

	changePassword(params: {
		dto: ChangePasswordDtoReq
		sessionId: string | null
		userId: string
	}): Promise<void> {
		return this.auth.changePassword(params.userId, params.dto, params.sessionId)
	}

	async listSessions(params: {
		currentSessionId: string | null
		userId: string
	}): Promise<AuthSessionsResponseDto> {
		const entries = await this.sessions.listActiveForUser(params.userId)
		return {
			ok: true,
			sessions: entries.map(entry =>
				this.mapSession(entry, params.currentSessionId)
			)
		}
	}

	async revokeOtherSessions(params: {
		currentSessionId: string | null
		userId: string
	}): Promise<OkResponseDto> {
		await this.sessions.destroyAllForUserExcept(
			params.userId,
			params.currentSessionId ?? ''
		)
		return { ok: true }
	}

	async revokeSession(params: {
		currentSessionId: string | null
		sid: string
		userId: string
	}): Promise<OkResponseDto> {
		if (!params.sid || params.sid === params.currentSessionId) {
			throw new BadRequestException('Текущую сессию нельзя завершить здесь')
		}

		await this.sessions.destroyForUser(params.userId, params.sid)
		return { ok: true }
	}

	listDomains(): Promise<CatalogDomainDto[]> {
		return this.domains.listCurrent()
	}

	createDomain(dto: CreateCatalogDomainDtoReq): Promise<CatalogDomainDto> {
		return this.domains.createCurrent(dto)
	}

	checkDomain(id: string): Promise<CatalogDomainCheckDto> {
		return this.domains.checkCurrent(id)
	}

	disableDomain(id: string): Promise<CatalogDomainDto> {
		return this.domains.disableCurrent(id)
	}

	listSaleUnits(options: {
		includeInactive?: boolean
		includeArchived?: boolean
	}) {
		return this.saleUnits.getAll(options)
	}

	getSaleUnit(id: string) {
		return this.saleUnits.getById(id)
	}

	createSaleUnit(dto: CreateCatalogSaleUnitDtoReq) {
		return this.saleUnits.create(dto)
	}

	updateSaleUnit(id: string, dto: UpdateCatalogSaleUnitDtoReq) {
		return this.saleUnits.update(id, dto)
	}

	archiveSaleUnit(id: string): Promise<OkResponseDto> {
		return this.saleUnits.archive(id)
	}

	async getYandexMetrika(): Promise<CatalogYandexMetrikaDto> {
		const metric = await this.findCurrentCatalogMetrikaMetric()
		return { counterId: metric?.counterId ?? null }
	}

	async updateYandexMetrika(
		dto: UpdateCatalogYandexMetrikaDtoReq
	): Promise<CatalogYandexMetrikaDto> {
		const catalogId = mustCatalogId()
		const counterId = dto.counterId.trim()
		const currentMetrics = await this.listCurrentCatalogMetrikaMetrics(catalogId)
		const metric = await this.prisma.metrics.upsert({
			where: { counterId },
			update: {
				deleteAt: null,
				provider: Metric.YANDEX,
				scope: MetricScope.CATALOG
			},
			create: {
				provider: Metric.YANDEX,
				scope: MetricScope.CATALOG,
				counterId
			},
			select: {
				id: true,
				counterId: true
			}
		})

		await this.prisma.catalog.update({
			where: { id: catalogId },
			data: {
				metrics: {
					connect: [{ id: metric.id }],
					disconnect: currentMetrics
						.filter(item => item.id !== metric.id)
						.map(item => ({ id: item.id }))
				}
			},
			select: { id: true }
		})

		return { counterId: metric.counterId }
	}

	async deleteYandexMetrika(): Promise<OkResponseDto> {
		const catalogId = mustCatalogId()
		const currentMetrics = await this.listCurrentCatalogMetrikaMetrics(catalogId)
		if (currentMetrics.length > 0) {
			await this.prisma.catalog.update({
				where: { id: catalogId },
				data: {
					metrics: {
						disconnect: currentMetrics.map(metric => ({ id: metric.id }))
					}
				},
				select: { id: true }
			})
		}

		return { ok: true }
	}

	getMoySkladStatus() {
		return this.integration.getMoySkladStatus()
	}

	getMoySklad() {
		return this.integration.getMoySklad()
	}

	getMoySkladRuns(limit?: number) {
		return this.integration.getMoySkladRuns(limit)
	}

	getMoySkladRunProgress(runId: string) {
		return this.integration.getMoySkladRunProgress(runId)
	}

	getMoySkladOrderExportRefs() {
		return this.integration.getMoySkladOrderExportRefs()
	}

	upsertMoySklad(dto: Parameters<IntegrationService['upsertMoySklad']>[0]) {
		return this.integration.upsertMoySklad(dto)
	}

	updateMoySklad(dto: Parameters<IntegrationService['updateMoySklad']>[0]) {
		return this.integration.updateMoySklad(dto)
	}

	removeMoySklad() {
		return this.integration.removeMoySklad()
	}

	testMoySkladConnection(
		dto: Parameters<IntegrationService['testMoySkladConnection']>[0]
	) {
		return this.integration.testMoySkladConnection(dto)
	}

	syncMoySkladCatalog() {
		return this.integration.syncMoySkladCatalog()
	}

	async cancelMoySkladSync(): Promise<OkResponseDto> {
		await this.integration.cancelMoySkladSync()
		return { ok: true }
	}

	getIikoStatus() {
		return this.integration.getIikoStatus()
	}

	getIiko() {
		return this.integration.getIiko()
	}

	getIikoRuns(limit?: number) {
		return this.integration.getIikoRuns(limit)
	}

	getIikoWebhookEvents(limit?: number, status?: string) {
		return this.integration.getIikoWebhookEvents(limit, status)
	}

	retryIikoWebhookEvent(eventId: string) {
		return this.integration.retryIikoWebhookEvent(eventId)
	}

	getIikoRunProgress(runId: string) {
		return this.integration.getIikoRunProgress(runId)
	}

	upsertIiko(dto: Parameters<IntegrationService['upsertIiko']>[0]) {
		return this.integration.upsertIiko(dto)
	}

	updateIiko(dto: Parameters<IntegrationService['updateIiko']>[0]) {
		return this.integration.updateIiko(dto)
	}

	removeIiko() {
		return this.integration.removeIiko()
	}

	testIikoConnection(
		dto: Parameters<IntegrationService['testIikoConnection']>[0]
	) {
		return this.integration.testIikoConnection(dto)
	}

	previewIikoImport(
		dto: Parameters<IntegrationService['previewIikoImport']>[0]
	) {
		return this.integration.previewIikoImport(dto)
	}

	syncIikoCatalog() {
		return this.integration.syncIikoCatalog()
	}

	syncIikoStock() {
		return this.integration.syncIikoStock()
	}

	syncIikoProduct(productId: string) {
		return this.integration.syncIikoProduct(productId)
	}

	setupIikoWebhooks() {
		return this.integration.setupIikoWebhooks()
	}

	disableIikoWebhooks() {
		return this.integration.disableIikoWebhooks()
	}

	private async findCurrentCatalogMetrikaMetric(): Promise<{
		counterId: string
		id: string
	} | null> {
		const catalogId = mustCatalogId()
		const metrics = await this.listCurrentCatalogMetrikaMetrics(catalogId)
		return metrics[0] ?? null
	}

	private async listCurrentCatalogMetrikaMetrics(catalogId: string) {
		const catalog = await this.prisma.catalog.findUnique({
			where: { id: catalogId },
			select: {
				metrics: {
					where: {
						provider: Metric.YANDEX,
						scope: MetricScope.CATALOG,
						deleteAt: null
					},
					select: {
						id: true,
						counterId: true
					},
					orderBy: [{ createdAt: 'asc' }]
				}
			}
		})

		if (!catalog) {
			throw new NotFoundException('Каталог не найден')
		}

		return catalog.metrics
	}

	private mapSession(
		entry: ActiveSessionEntry,
		currentSid: string | null
	): AuthSessionDto {
		const userAgent = entry.client.userAgent

		return {
			id: entry.sid,
			isCurrent: entry.sid === currentSid,
			isPrimary: entry.isPrimary,
			createdAt: new Date(entry.createdAt).toISOString(),
			expiresAt: entry.expiresAt ? new Date(entry.expiresAt).toISOString() : null,
			ttlSeconds: entry.ttlSeconds,
			client: {
				ip: entry.client.ip,
				browser: userAgent?.browser ?? null,
				os: userAgent?.os ?? null,
				device: userAgent?.device ?? null,
				geo: entry.client.geo
					? {
							city: entry.client.geo.city,
							region: entry.client.geo.region
						}
					: null
			}
		}
	}
}
