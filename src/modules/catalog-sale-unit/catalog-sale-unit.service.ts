import {
	BadRequestException,
	Inject,
	Injectable,
	NotFoundException
} from '@nestjs/common'
import slugify from 'slugify'

import {
	CAPABILITY_ASSERT_PORT,
	type CapabilityAssertPort
} from '@/modules/capability/contracts'
import { mustCatalogId } from '@/shared/tenancy/ctx'
import {
	assertHasUpdateFields,
	normalizeNullableTrimmedString
} from '@/shared/utils'

import {
	CatalogSaleUnitRecord,
	CatalogSaleUnitRepository,
	CatalogSaleUnitUpdateData
} from './catalog-sale-unit.repository'
import { CreateCatalogSaleUnitDtoReq } from './dto/requests/create-catalog-sale-unit.dto.req'
import { UpdateCatalogSaleUnitDtoReq } from './dto/requests/update-catalog-sale-unit.dto.req'

const CODE_FALLBACK = 'unit'
const CODE_MAX_LENGTH = 100

function normalizeName(value: string | undefined): string {
	const name = value?.trim()
	if (!name)
		throw new BadRequestException('Название единицы продажи обязательно')
	return name
}

function buildCodeBase(value: string): string {
	return (
		slugify(value, { lower: true, strict: true, trim: true })
			.replace(/-+/g, '-')
			.replace(/^[-_]+|[-_]+$/g, '')
			.slice(0, CODE_MAX_LENGTH) || CODE_FALLBACK
	)
}

@Injectable()
export class CatalogSaleUnitService {
	constructor(
		private readonly repo: CatalogSaleUnitRepository,
		@Inject(CAPABILITY_ASSERT_PORT)
		private readonly featureEntitlements: CapabilityAssertPort
	) {}

	async getAll(options: { includeArchived?: boolean } = {}) {
		const catalogId = mustCatalogId()
		await this.featureEntitlements.assertCanUseCatalogSaleUnits(catalogId)
		return this.repo.findAll(catalogId, options.includeArchived === true)
	}

	async getById(id: string) {
		const catalogId = mustCatalogId()
		await this.featureEntitlements.assertCanUseCatalogSaleUnits(catalogId)
		return this.requireRecord(await this.repo.findById(id, catalogId))
	}

	async create(dto: CreateCatalogSaleUnitDtoReq) {
		const catalogId = mustCatalogId()
		await this.featureEntitlements.assertCanUseCatalogSaleUnits(catalogId)
		const name = normalizeName(dto.name)
		const explicitCode = normalizeNullableTrimmedString(dto.code)
		const code = explicitCode ? buildCodeBase(explicitCode) : buildCodeBase(name)
		const existing = await this.repo.findByCode(catalogId, code)

		if (existing) {
			if (explicitCode && !existing.deleteAt) {
				throw new BadRequestException('Единица продажи с таким кодом уже есть')
			}

			const restored = await this.repo.update(existing.id, catalogId, {
				name,
				defaultBaseQuantity: this.normalizeDefaultBaseQuantity(
					dto.defaultBaseQuantity,
					Number(existing.defaultBaseQuantity)
				),
				barcode: dto.barcode ?? existing.barcode,
				isActive: true,
				deleteAt: null,
				displayOrder: dto.displayOrder ?? existing.displayOrder
			})
			return this.requireUpdated(restored)
		}

		return this.repo.create({
			catalogId,
			code,
			name,
			defaultBaseQuantity: this.normalizeDefaultBaseQuantity(
				dto.defaultBaseQuantity
			),
			barcode: dto.barcode ?? null,
			displayOrder: dto.displayOrder ?? 0
		})
	}

	async update(id: string, dto: UpdateCatalogSaleUnitDtoReq) {
		const catalogId = mustCatalogId()
		await this.featureEntitlements.assertCanUseCatalogSaleUnits(catalogId)
		const current = this.requireRecord(
			await this.repo.findById(id, catalogId, true)
		)
		const data: CatalogSaleUnitUpdateData = {}

		if (dto.name !== undefined) {
			data.name = normalizeName(dto.name)
		}
		if (dto.code !== undefined) {
			const code = buildCodeBase(normalizeName(dto.code))
			if (await this.repo.existsCode(catalogId, code, id)) {
				throw new BadRequestException('Единица продажи с таким кодом уже есть')
			}
			data.code = code
		}
		if (dto.defaultBaseQuantity !== undefined) {
			data.defaultBaseQuantity = this.normalizeDefaultBaseQuantity(
				dto.defaultBaseQuantity
			)
		}
		if (dto.barcode !== undefined) {
			data.barcode = dto.barcode
		}
		if (dto.displayOrder !== undefined) {
			data.displayOrder = dto.displayOrder
		}

		assertHasUpdateFields(data)
		const updated = this.requireUpdated(
			await this.repo.update(id, catalogId, data)
		)
		await this.repo.syncVariantSnapshots(updated.id, {
			...(data.code !== undefined ? { code: updated.code } : {}),
			...(data.name !== undefined ? { name: updated.name } : {})
		})
		return updated
	}

	async archive(id: string) {
		const catalogId = mustCatalogId()
		await this.featureEntitlements.assertCanUseCatalogSaleUnits(catalogId)
		const archived = this.requireUpdated(
			await this.repo.update(id, catalogId, {
				deleteAt: new Date(),
				isActive: false
			})
		)
		return { ok: Boolean(archived) }
	}

	private normalizeDefaultBaseQuantity(value?: number, fallback = 1): number {
		const quantity = value ?? fallback
		if (!Number.isFinite(quantity) || quantity <= 0) {
			throw new BadRequestException('Количество внутри должно быть больше нуля')
		}
		return quantity
	}

	private requireRecord<T>(record: T | null): T {
		if (!record) throw new NotFoundException('Единица продажи не найдена')
		return record
	}

	private requireUpdated(
		records: CatalogSaleUnitRecord[]
	): CatalogSaleUnitRecord {
		const record = records[0]
		if (!record) throw new NotFoundException('Единица продажи не найдена')
		return record
	}
}
