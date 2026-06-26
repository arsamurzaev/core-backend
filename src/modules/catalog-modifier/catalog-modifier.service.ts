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
import { CacheService } from '@/shared/cache/cache.service'
import {
	CATEGORY_PRODUCTS_CACHE_VERSION,
	PRODUCTS_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'
import {
	assertCurrentCatalogCanManageCatalogContent,
	mustCatalogId
} from '@/shared/tenancy/ctx'
import {
	assertHasUpdateFields,
	normalizeNullableTrimmedString
} from '@/shared/utils'

import {
	CatalogModifierGroupRecord,
	CatalogModifierGroupUpdateData,
	CatalogModifierOptionRecord,
	CatalogModifierOptionUpdateData,
	CatalogModifierRepository,
	ProductModifierGroupRecord,
	ProductModifierGroupReplacement,
	ProductModifierOptionReplacement
} from './catalog-modifier.repository'
import type { CatalogModifierManagementPort } from './contracts'
import {
	CatalogModifierGroupOptionDtoReq,
	CreateCatalogModifierGroupDtoReq,
	UpdateCatalogModifierGroupDtoReq
} from './dto/requests/catalog-modifier-group.dto.req'
import {
	CreateCatalogModifierOptionDtoReq,
	UpdateCatalogModifierOptionDtoReq
} from './dto/requests/catalog-modifier-option.dto.req'
import {
	ProductModifierGroupBindingDtoReq,
	ProductModifierOptionBindingDtoReq,
	SetProductModifiersDtoReq
} from './dto/requests/set-product-modifiers.dto.req'
import {
	CatalogModifierGroupDto,
	CatalogModifierOptionDto,
	CatalogModifierStateDto,
	ProductModifierGroupDto
} from './dto/responses/catalog-modifier.dto.res'

const CODE_FALLBACK = 'modifier'
const CODE_MAX_LENGTH = 100

type ProductModifierOptionSource = {
	catalogModifierOptionId?: string | null
	code?: string | null
	name?: string | null
	price?: number | null
	maxQuantity?: number | null
	isDefault?: boolean | null
	isAvailable?: boolean | null
	displayOrder?: number | null
}

function normalizeName(value: string | undefined, fieldName: string): string {
	const name = value?.trim()
	if (!name) {
		const labels: Record<string, string> = {
			code: 'Код обязателен',
			name: 'Название обязательно',
			optionId: 'Не указана опция модификатора',
			'modifier group name': 'Название группы модификаторов обязательно',
			'modifier option name': 'Название опции модификатора обязательно'
		}
		throw new BadRequestException(labels[fieldName] ?? 'Поле обязательно')
	}
	return name
}

function normalizeId(value?: string | null): string | null {
	const id = value?.trim()
	return id || null
}

function buildCodeBase(value: string): string {
	return (
		slugify(value, { lower: true, strict: true, trim: true })
			.replace(/-+/g, '-')
			.replace(/^[-_]+|[-_]+$/g, '')
			.slice(0, CODE_MAX_LENGTH) || CODE_FALLBACK
	)
}

function toDecimalString(value: unknown): string {
	if (value === null || value === undefined) return '0'
	if (
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean' ||
		typeof value === 'bigint' ||
		value instanceof Date
	) {
		return String(value)
	}
	if (typeof value === 'object') {
		const toString = (value as { toString?: () => string }).toString
		if (
			typeof toString === 'function' &&
			toString !== Object.prototype.toString
		) {
			const stringified = (value as { toString: () => string }).toString()
			return stringified || '0'
		}
	}
	return '0'
}

function toNumber(value: unknown): number {
	const parsed = Number(toDecimalString(value))
	return Number.isFinite(parsed) ? parsed : 0
}

function mapById<T extends { id: string }>(items: T[]): Map<string, T> {
	return new Map(items.map(item => [item.id, item]))
}

function assertSelectionBounds(params: {
	isRequired?: boolean
	minSelected?: number
	maxSelected?: number | null
}) {
	const minSelected = params.minSelected ?? 0
	const maxSelected = params.maxSelected ?? null
	if (minSelected < 0) {
		throw new BadRequestException(
			'Минимальное количество выбранных опций должно быть больше или равно 0'
		)
	}
	if (maxSelected !== null && maxSelected < 1) {
		throw new BadRequestException(
			'Максимальное количество выбранных опций должно быть больше 0'
		)
	}
	if (maxSelected !== null && maxSelected < minSelected) {
		throw new BadRequestException(
			'Максимальное количество выбранных опций не может быть меньше минимального'
		)
	}
	if (params.isRequired && maxSelected === 0) {
		throw new BadRequestException(
			'Обязательная группа модификаторов не может иметь максимум 0'
		)
	}
}

function resolveEffectiveMinSelected(
	isRequired: boolean,
	minSelected?: number | null
): number {
	const normalized = Math.max(0, Math.trunc(minSelected ?? 0))
	return isRequired ? Math.max(1, normalized) : 0
}

@Injectable()
export class CatalogModifierService implements CatalogModifierManagementPort {
	constructor(
		private readonly repo: CatalogModifierRepository,
		private readonly cache: CacheService,
		@Inject(CAPABILITY_ASSERT_PORT)
		private readonly capabilities: CapabilityAssertPort
	) {}

	async getState(
		options: { includeArchived?: boolean; includeInactive?: boolean } = {}
	): Promise<CatalogModifierStateDto> {
		const catalogId = mustCatalogId()
		await this.capabilities.assertCanUseCatalogModifiers(catalogId)
		const [groups, modifierOptions] = await Promise.all([
			this.repo.findAllGroups(catalogId, options),
			this.repo.findAllOptions(catalogId, options)
		])
		return {
			groups: groups.map(group => this.mapGroup(group)),
			options: modifierOptions.map(option => this.mapOption(option))
		}
	}

	async getGroups(options: {
		includeArchived?: boolean
		includeInactive?: boolean
	}): Promise<CatalogModifierGroupDto[]> {
		const catalogId = mustCatalogId()
		await this.capabilities.assertCanUseCatalogModifiers(catalogId)
		return (await this.repo.findAllGroups(catalogId, options)).map(group =>
			this.mapGroup(group)
		)
	}

	async getOptions(options: {
		includeArchived?: boolean
		includeInactive?: boolean
	}): Promise<CatalogModifierOptionDto[]> {
		const catalogId = mustCatalogId()
		await this.capabilities.assertCanUseCatalogModifiers(catalogId)
		return (await this.repo.findAllOptions(catalogId, options)).map(option =>
			this.mapOption(option)
		)
	}

	async createOption(
		dto: CreateCatalogModifierOptionDtoReq
	): Promise<CatalogModifierOptionDto> {
		assertCurrentCatalogCanManageCatalogContent()
		const catalogId = mustCatalogId()
		await this.capabilities.assertCanUseCatalogModifiers(catalogId)
		const name = normalizeName(dto.name, 'name')
		const explicitCode = normalizeNullableTrimmedString(dto.code)
		const code = explicitCode ? buildCodeBase(explicitCode) : buildCodeBase(name)
		const existing = await this.repo.findOptionByCode(catalogId, code)

		if (existing) {
			if (!existing.deleteAt) {
				throw new BadRequestException('Код опции модификатора уже используется')
			}
			return this.mapOption(
				this.requireUpdatedOption(
					await this.repo.updateOption(existing.id, catalogId, {
						name,
						description: dto.description ?? existing.description,
						defaultPrice: dto.defaultPrice ?? toNumber(existing.defaultPrice),
						isActive: dto.isActive ?? true,
						displayOrder: dto.displayOrder ?? existing.displayOrder,
						deleteAt: null
					})
				)
			)
		}

		return this.mapOption(
			await this.repo.createOption({
				catalogId,
				code,
				name,
				description: dto.description ?? null,
				defaultPrice: dto.defaultPrice ?? 0,
				isActive: dto.isActive ?? true,
				displayOrder: dto.displayOrder ?? 0
			})
		)
	}

	async updateOption(
		id: string,
		dto: UpdateCatalogModifierOptionDtoReq
	): Promise<CatalogModifierOptionDto> {
		assertCurrentCatalogCanManageCatalogContent()
		const catalogId = mustCatalogId()
		await this.capabilities.assertCanUseCatalogModifiers(catalogId)
		this.requireOption(await this.repo.findOptionById(id, catalogId, true))
		const data: CatalogModifierOptionUpdateData = {}

		if (dto.name !== undefined) data.name = normalizeName(dto.name, 'name')
		if (dto.code !== undefined) {
			const code = buildCodeBase(normalizeName(dto.code, 'code'))
			if (await this.repo.existsOptionCode(catalogId, code, id)) {
				throw new BadRequestException('Код опции модификатора уже используется')
			}
			data.code = code
		}
		if (dto.description !== undefined) data.description = dto.description
		if (dto.defaultPrice !== undefined) data.defaultPrice = dto.defaultPrice
		if (dto.isActive !== undefined) {
			data.isActive = dto.isActive
			if (dto.isActive) data.deleteAt = null
		}
		if (dto.displayOrder !== undefined) data.displayOrder = dto.displayOrder

		assertHasUpdateFields(data)
		await this.invalidateProductReadCaches(catalogId)
		return this.mapOption(
			this.requireUpdatedOption(await this.repo.updateOption(id, catalogId, data))
		)
	}

	async archiveOption(id: string) {
		assertCurrentCatalogCanManageCatalogContent()
		const catalogId = mustCatalogId()
		await this.capabilities.assertCanUseCatalogModifiers(catalogId)
		const archived = this.requireUpdatedOption(
			await this.repo.updateOption(id, catalogId, {
				deleteAt: new Date(),
				isActive: false
			})
		)
		await this.invalidateProductReadCaches(catalogId)
		return { ok: Boolean(archived) }
	}

	async createGroup(
		dto: CreateCatalogModifierGroupDtoReq
	): Promise<CatalogModifierGroupDto> {
		assertCurrentCatalogCanManageCatalogContent()
		const catalogId = mustCatalogId()
		await this.capabilities.assertCanUseCatalogModifiers(catalogId)
		const name = normalizeName(dto.name, 'name')
		const explicitCode = normalizeNullableTrimmedString(dto.code)
		const code = explicitCode ? buildCodeBase(explicitCode) : buildCodeBase(name)
		const isRequired = dto.isRequired ?? false
		const minSelected = resolveEffectiveMinSelected(isRequired, dto.minSelected)
		const maxSelected = dto.maxSelected ?? null
		assertSelectionBounds({
			isRequired,
			minSelected,
			maxSelected
		})
		const options = this.normalizeGroupOptions(dto.options ?? [])
		const existing = await this.repo.findGroupByCode(catalogId, code)

		if (existing) {
			if (!existing.deleteAt) {
				throw new BadRequestException('Код группы модификаторов уже используется')
			}
			const restoredRequired = dto.isRequired ?? existing.isRequired
			const restoredMinSelected = resolveEffectiveMinSelected(
				restoredRequired,
				dto.minSelected ?? existing.minSelected
			)
			const restored = this.requireUpdatedGroup(
				await this.repo.updateGroup(existing.id, catalogId, {
					name,
					description: dto.description ?? existing.description,
					isRequired: restoredRequired,
					minSelected: restoredMinSelected,
					maxSelected,
					isActive: dto.isActive ?? true,
					displayOrder: dto.displayOrder ?? existing.displayOrder,
					deleteAt: null
				})
			)
			if (dto.options) {
				await this.repo.replaceGroupOptions(restored.id, catalogId, options)
			}
			return this.mapGroup(
				this.requireGroup(await this.repo.findGroupById(restored.id, catalogId))
			)
		}

		const created = await this.repo.createGroup(
			{
				catalogId,
				code,
				name,
				description: dto.description ?? null,
				isRequired,
				minSelected,
				maxSelected,
				isActive: dto.isActive ?? true,
				displayOrder: dto.displayOrder ?? 0
			},
			options
		)
		return this.mapGroup(this.requireGroup(created))
	}

	async updateGroup(
		id: string,
		dto: UpdateCatalogModifierGroupDtoReq
	): Promise<CatalogModifierGroupDto> {
		assertCurrentCatalogCanManageCatalogContent()
		const catalogId = mustCatalogId()
		await this.capabilities.assertCanUseCatalogModifiers(catalogId)
		const current = this.requireGroup(
			await this.repo.findGroupById(id, catalogId, true)
		)
		const data: CatalogModifierGroupUpdateData = {}
		const nextRequired = dto.isRequired ?? current.isRequired
		const nextMin = resolveEffectiveMinSelected(
			nextRequired,
			dto.minSelected ?? current.minSelected
		)
		const nextMax =
			dto.maxSelected === undefined ? current.maxSelected : dto.maxSelected
		assertSelectionBounds({
			isRequired: nextRequired,
			minSelected: nextMin,
			maxSelected: nextMax
		})

		if (dto.name !== undefined) data.name = normalizeName(dto.name, 'name')
		if (dto.code !== undefined) {
			const code = buildCodeBase(normalizeName(dto.code, 'code'))
			if (await this.repo.existsGroupCode(catalogId, code, id)) {
				throw new BadRequestException('Код группы модификаторов уже используется')
			}
			data.code = code
		}
		if (dto.description !== undefined) data.description = dto.description
		if (dto.isRequired !== undefined) data.isRequired = dto.isRequired
		if (
			dto.isRequired !== undefined ||
			dto.minSelected !== undefined ||
			current.minSelected !== nextMin
		) {
			data.minSelected = nextMin
		}
		if (dto.maxSelected !== undefined) data.maxSelected = dto.maxSelected
		if (dto.isActive !== undefined) {
			data.isActive = dto.isActive
			if (dto.isActive) data.deleteAt = null
		}
		if (dto.displayOrder !== undefined) data.displayOrder = dto.displayOrder

		if (Object.keys(data).length) {
			this.requireUpdatedGroup(await this.repo.updateGroup(id, catalogId, data))
		}
		if (dto.options) {
			await this.repo.replaceGroupOptions(
				id,
				catalogId,
				this.normalizeGroupOptions(dto.options)
			)
		} else {
			assertHasUpdateFields(data)
		}
		await this.invalidateProductReadCaches(catalogId)
		return this.mapGroup(
			this.requireGroup(await this.repo.findGroupById(id, catalogId, true))
		)
	}

	async archiveGroup(id: string) {
		assertCurrentCatalogCanManageCatalogContent()
		const catalogId = mustCatalogId()
		await this.capabilities.assertCanUseCatalogModifiers(catalogId)
		const archived = this.requireUpdatedGroup(
			await this.repo.updateGroup(id, catalogId, {
				deleteAt: new Date(),
				isActive: false
			})
		)
		await this.invalidateProductReadCaches(catalogId)
		return { ok: Boolean(archived) }
	}

	async getProductModifiers(
		productId: string
	): Promise<ProductModifierGroupDto[]> {
		const catalogId = mustCatalogId()
		await this.capabilities.assertCanUseCatalogModifiers(catalogId)
		return (await this.repo.findProductModifiers(productId, catalogId)).map(
			group => this.mapProductGroup(group)
		)
	}

	async setProductModifiers(
		productId: string,
		dto: SetProductModifiersDtoReq
	): Promise<ProductModifierGroupDto[]> {
		assertCurrentCatalogCanManageCatalogContent()
		const catalogId = mustCatalogId()
		await this.capabilities.assertCanUseCatalogModifiers(catalogId)
		if (!(await this.repo.productExists(catalogId, productId))) {
			throw new NotFoundException('Товар не найден')
		}
		const groups = await this.normalizeProductGroups(catalogId, dto.groups)
		const replaced = await this.repo.replaceProductModifiers(
			catalogId,
			productId,
			groups
		)
		await this.invalidateProductReadCaches(catalogId)
		return replaced.map(group => this.mapProductGroup(group))
	}

	private normalizeGroupOptions(options: CatalogModifierGroupOptionDtoReq[]) {
		const seen = new Set<string>()
		return options.map((option, index) => {
			const optionId = normalizeName(option.optionId, 'optionId')
			if (seen.has(optionId)) {
				throw new BadRequestException('Опция модификатора дублируется в группе')
			}
			seen.add(optionId)
			return {
				optionId,
				defaultPrice: option.defaultPrice ?? null,
				isDefault: option.isDefault ?? false,
				isActive: option.isActive ?? true,
				displayOrder: option.displayOrder ?? index
			}
		})
	}

	private async normalizeProductGroups(
		catalogId: string,
		inputGroups: ProductModifierGroupBindingDtoReq[]
	): Promise<ProductModifierGroupReplacement[]> {
		const groupIds = inputGroups
			.map(group => normalizeId(group.catalogModifierGroupId))
			.filter((id): id is string => Boolean(id))
		const optionIds = inputGroups
			.flatMap(group => group.options ?? [])
			.map(option => normalizeId(option.catalogModifierOptionId))
			.filter((id): id is string => Boolean(id))
		const catalogGroups = mapById(
			await this.repo.findCatalogGroupsByIds(catalogId, groupIds)
		)
		const catalogOptions = mapById(
			await this.repo.findCatalogOptionsByIds(catalogId, optionIds)
		)
		const result: ProductModifierGroupReplacement[] = []
		const seenGroupKeys = new Set<string>()

		for (const [index, group] of inputGroups.entries()) {
			const catalogGroupId = normalizeId(group.catalogModifierGroupId)
			const catalogGroup = catalogGroupId
				? catalogGroups.get(catalogGroupId)
				: null
			if (catalogGroupId && !catalogGroup) {
				throw new BadRequestException(
					'Группа модификаторов не принадлежит каталогу'
				)
			}

			const variantId = normalizeId(group.variantId)
			const name = normalizeName(
				group.name ?? catalogGroup?.name,
				'modifier group name'
			)
			const code = buildCodeBase(group.code ?? catalogGroup?.code ?? name)
			const scopeKey = variantId ?? 'product'
			const groupKey = `${scopeKey}:${code}`
			if (seenGroupKeys.has(groupKey)) {
				throw new BadRequestException(
					'Группа модификаторов дублируется для выбранной области'
				)
			}
			seenGroupKeys.add(groupKey)

			const isRequired = group.isRequired ?? catalogGroup?.isRequired ?? false
			const minSelected = resolveEffectiveMinSelected(
				isRequired,
				group.minSelected ?? catalogGroup?.minSelected
			)
			const maxSelected =
				group.maxSelected === undefined
					? (catalogGroup?.maxSelected ?? null)
					: group.maxSelected
			assertSelectionBounds({ isRequired, minSelected, maxSelected })

			result.push({
				variantId,
				catalogModifierGroupId: catalogGroupId,
				code,
				name,
				description:
					group.description === undefined
						? (catalogGroup?.description ?? null)
						: group.description,
				isRequired,
				minSelected,
				maxSelected,
				isActive: group.isActive ?? true,
				displayOrder: group.displayOrder ?? index,
				options: this.normalizeProductOptions(
					group.options,
					catalogGroup,
					catalogOptions
				)
			})
		}

		return result
	}

	private normalizeProductOptions(
		inputOptions: ProductModifierOptionBindingDtoReq[] | undefined,
		catalogGroup: CatalogModifierGroupRecord | null,
		catalogOptions: Map<string, CatalogModifierOptionRecord>
	): ProductModifierOptionReplacement[] {
		const sourceOptions: ProductModifierOptionSource[] =
			inputOptions ??
			catalogGroup?.options
				.filter(option => option.deleteAt === null && option.isActive)
				.map(option => ({
					catalogModifierOptionId: option.optionId,
					price: toNumber(option.defaultPrice ?? option.option.defaultPrice),
					isDefault: option.isDefault,
					isAvailable: option.isActive,
					displayOrder: option.displayOrder
				})) ??
			[]
		const seen = new Set<string>()

		return sourceOptions.map((option, index) => {
			const catalogOptionId = normalizeId(option.catalogModifierOptionId)
			const catalogOption = catalogOptionId
				? (catalogOptions.get(catalogOptionId) ??
					catalogGroup?.options.find(item => item.optionId === catalogOptionId)
						?.option)
				: null
			if (catalogOptionId && !catalogOption) {
				throw new BadRequestException('Опция модификатора не принадлежит каталогу')
			}
			const name = normalizeName(
				option.name ?? catalogOption?.name,
				'modifier option name'
			)
			const code = buildCodeBase(option.code ?? catalogOption?.code ?? name)
			if (seen.has(code)) {
				throw new BadRequestException('Опция модификатора дублируется в группе')
			}
			seen.add(code)
			const maxQuantity = option.maxQuantity ?? null
			if (maxQuantity !== null && maxQuantity < 1) {
				throw new BadRequestException(
					'Максимальное количество опции должно быть больше 0'
				)
			}
			return {
				catalogModifierOptionId: catalogOptionId,
				code,
				name,
				price: option.price ?? toNumber(catalogOption?.defaultPrice) ?? 0,
				maxQuantity,
				isDefault: option.isDefault ?? false,
				isAvailable: option.isAvailable ?? true,
				displayOrder: option.displayOrder ?? index
			}
		})
	}

	private async invalidateProductReadCaches(catalogId: string): Promise<void> {
		await this.cache.bumpVersion(PRODUCTS_CACHE_VERSION, catalogId)
		await this.cache.bumpVersion(CATEGORY_PRODUCTS_CACHE_VERSION, catalogId)
	}

	private mapOption(
		option: CatalogModifierOptionRecord
	): CatalogModifierOptionDto {
		return {
			id: option.id,
			catalogId: option.catalogId,
			code: option.code,
			name: option.name,
			description: option.description,
			defaultPrice: toDecimalString(option.defaultPrice),
			isActive: option.isActive,
			displayOrder: option.displayOrder,
			deleteAt: option.deleteAt?.toISOString() ?? null
		}
	}

	private mapGroup(group: CatalogModifierGroupRecord): CatalogModifierGroupDto {
		return {
			id: group.id,
			catalogId: group.catalogId,
			code: group.code,
			name: group.name,
			description: group.description,
			isRequired: group.isRequired,
			minSelected: group.minSelected,
			maxSelected: group.maxSelected,
			isActive: group.isActive,
			displayOrder: group.displayOrder,
			deleteAt: group.deleteAt?.toISOString() ?? null,
			options: group.options
				.filter(option => option.deleteAt === null)
				.map(option => ({
					groupId: option.groupId,
					optionId: option.optionId,
					defaultPrice:
						option.defaultPrice === null
							? null
							: toDecimalString(option.defaultPrice),
					isDefault: option.isDefault,
					isActive: option.isActive,
					displayOrder: option.displayOrder,
					option: this.mapOption(option.option)
				}))
		}
	}

	private mapProductGroup(
		group: ProductModifierGroupRecord
	): ProductModifierGroupDto {
		return {
			id: group.id,
			productId: group.productId,
			variantId: group.variantId,
			catalogModifierGroupId: group.catalogModifierGroupId,
			scope: group.scope,
			code: group.code,
			name: group.name,
			description: group.description,
			isRequired: group.isRequired,
			minSelected: group.minSelected,
			maxSelected: group.maxSelected,
			isActive: group.isActive,
			displayOrder: group.displayOrder,
			options: group.options
				.filter(option => option.deleteAt === null)
				.map(option => ({
					id: option.id,
					productModifierGroupId: option.productModifierGroupId,
					catalogModifierOptionId: option.catalogModifierOptionId,
					code: option.code,
					name: option.name,
					price: toDecimalString(option.price),
					maxQuantity: option.maxQuantity,
					isDefault: option.isDefault,
					isAvailable: option.isAvailable,
					displayOrder: option.displayOrder
				}))
		}
	}

	private requireOption(
		option: CatalogModifierOptionRecord | null
	): CatalogModifierOptionRecord {
		if (!option) throw new NotFoundException('Опция модификатора не найдена')
		return option
	}

	private requireGroup(
		group: CatalogModifierGroupRecord | null
	): CatalogModifierGroupRecord {
		if (!group) throw new NotFoundException('Группа модификаторов не найдена')
		return group
	}

	private requireUpdatedOption(
		records: CatalogModifierOptionRecord[]
	): CatalogModifierOptionRecord {
		return this.requireOption(records[0] ?? null)
	}

	private requireUpdatedGroup(
		records: CatalogModifierGroupRecord[]
	): CatalogModifierGroupRecord {
		return this.requireGroup(records[0] ?? null)
	}
}
