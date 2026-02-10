import { createHash } from 'crypto'

import { DataType, ProductVariantStatus } from '@generated/enums'
import { BadRequestException, Injectable } from '@nestjs/common'
import slugify from 'slugify'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

import { ProductVariantDtoReq } from './dto/requests/product-variant.dto.req'

export type ProductVariantAttributeInput = {
	attributeId: string
	enumValueId?: string
	value?: string
	displayName?: string
}

export type ProductVariantData = {
	sku: string
	variantKey: string
	stock: number
	price: number
	status: ProductVariantStatus
	attributes: ProductVariantAttributeInput[]
}

type VariantAttributeMeta = {
	id: string
	key: string
	displayOrder: number
	dataType: DataType
}

type EnumValueMeta = {
	id: string
	attributeId: string
	value: string
}

const SKU_MAX_LENGTH = 100
const ENUM_VALUE_MAX_LENGTH = 255

function normalizeEnumValue(value: string): string {
	return value.trim().toLowerCase()
}

function normalizeEnumLabel(value: string): string {
	return value.trim()
}

@Injectable()
export class ProductVariantBuilder {
	constructor(private readonly prisma: PrismaService) {}

	async build(
		typeId: string,
		inputs?: ProductVariantDtoReq[],
		productSku?: string
	): Promise<ProductVariantData[]> {
		if (!inputs?.length) return []

		const variantAttributes = await this.loadVariantAttributes(typeId)
		if (!variantAttributes.length) {
			throw new BadRequestException('У типа нет вариантных атрибутов')
		}

		const orderedAttributes = [...variantAttributes].sort((a, b) => {
			if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder
			return a.key.localeCompare(b.key)
		})

		const attributeMap = new Map(variantAttributes.map(attr => [attr.id, attr]))
		const requiredAttributeIds = new Set(variantAttributes.map(attr => attr.id))
		const skuSet = new Set<string>()
		const enumValueIds = new Set<string>()
		const valueAttributeIds = new Set<string>()
		const baseSku = productSku?.trim()
		const hasBaseSku = Boolean(baseSku)

		for (const input of inputs) {
			const rawSku = input.sku?.trim()
			const skuLabel = rawSku ?? 'без SKU'

			if (!rawSku && !hasBaseSku) {
				throw new BadRequestException(
					'SKU варианта обязателен, если не указан SKU товара'
				)
			}

			if (!input.attributes?.length) {
				throw new BadRequestException(
					`Для варианта ${skuLabel} не заданы атрибуты`
				)
			}

			const providedIds = new Set<string>()

			for (const attr of input.attributes) {
				const attributeId = attr.attributeId?.trim()
				const enumValueId = attr.enumValueId?.trim()
				const valueLabel = attr.value?.trim()
				const hasEnumValueId = Boolean(enumValueId)
				const hasValue = Boolean(valueLabel)
				if (!attributeId) {
					throw new BadRequestException(
						`attributeId обязателен для варианта ${skuLabel}`
					)
				}
				if (!hasEnumValueId && !hasValue) {
					throw new BadRequestException(
						`Для варианта ${skuLabel} нужно указать enumValueId или value`
					)
				}
				if (hasEnumValueId && hasValue) {
					throw new BadRequestException(
						`Для варианта ${skuLabel} нельзя одновременно указывать enumValueId и value`
					)
				}

				const meta = attributeMap.get(attributeId)
				if (!meta) {
					throw new BadRequestException(
						`Атрибут ${attributeId} не является вариантным`
					)
				}
				if (meta.dataType !== DataType.ENUM) {
					throw new BadRequestException(
						`Вариантный атрибут ${meta.key} должен быть типа ENUM`
					)
				}
				if (providedIds.has(attributeId)) {
					throw new BadRequestException(
						`Дубликат атрибута ${meta.key} в варианте ${skuLabel}`
					)
				}

				providedIds.add(attributeId)
				if (hasEnumValueId) {
					enumValueIds.add(enumValueId!)
				} else {
					valueAttributeIds.add(attributeId)
				}
			}

			if (providedIds.size !== requiredAttributeIds.size) {
				const missing = [...requiredAttributeIds]
					.filter(id => !providedIds.has(id))
					.map(id => attributeMap.get(id)?.key ?? id)
				throw new BadRequestException(
					`Не указаны значения для атрибутов: ${missing.join(', ')}`
				)
			}
		}

		const enumValueMap = await this.loadEnumValues([...enumValueIds])
		const enumValuesByAttribute = await this.loadEnumValuesByAttribute([
			...valueAttributeIds
		])
		const variantKeySet = new Set<string>()

		return inputs.map(input => {
			const rawSku = input.sku?.trim()
			const stock = input.stock ?? 0
			const price = input.price ?? 0

			if (!Number.isInteger(stock) || stock < 0) {
				throw new BadRequestException(
					`Некорректный stock для варианта ${rawSku ?? 'без SKU'}`
				)
			}
			if (!Number.isFinite(price) || price < 0) {
				throw new BadRequestException(
					`Некорректная цена для варианта ${rawSku ?? 'без SKU'}`
				)
			}

			const valueByAttribute = new Map<string, string>()
			const preparedAttributes: ProductVariantAttributeInput[] = []

			for (const attr of input.attributes) {
				const attributeId = attr.attributeId.trim()
				const enumValueId = attr.enumValueId?.trim()
				const valueLabel = attr.value?.trim()

				if (enumValueId) {
					const enumValue = enumValueMap.get(enumValueId)
					if (!enumValue) {
						throw new BadRequestException(
							`Значение перечисления ${enumValueId} не найдено`
						)
					}
					if (enumValue.attributeId !== attributeId) {
						const meta = attributeMap.get(attributeId)
						throw new BadRequestException(
							`Значение перечисления ${enumValueId} не относится к атрибуту ${meta?.key ?? attributeId}`
						)
					}

					valueByAttribute.set(attributeId, enumValue.value)
					preparedAttributes.push({ attributeId, enumValueId })
					continue
				}

				const meta = attributeMap.get(attributeId)
				if (!valueLabel) {
					throw new BadRequestException(
						`Для атрибута ${meta?.key ?? attributeId} нужно передать value`
					)
				}

				const normalizedValue = normalizeEnumValue(valueLabel)
				if (!normalizedValue) {
					throw new BadRequestException(
						`Для атрибута ${meta?.key ?? attributeId} нужно передать value`
					)
				}
				if (normalizedValue.length > ENUM_VALUE_MAX_LENGTH) {
					throw new BadRequestException(
						`Значение для атрибута ${meta?.key ?? attributeId} превышает ${ENUM_VALUE_MAX_LENGTH} символов`
					)
				}

				const existingValues = enumValuesByAttribute.get(attributeId)
				if (existingValues && existingValues.size > 0) {
					throw new BadRequestException(
						`Атрибут ${meta?.key ?? attributeId} использует фиксированный список значений, передайте enumValueId`
					)
				}

				valueByAttribute.set(attributeId, normalizedValue)
				preparedAttributes.push({
					attributeId,
					value: normalizedValue,
					displayName: normalizeEnumLabel(valueLabel)
				})
			}

			const variantKey = orderedAttributes
				.map(attr => `${attr.key}=${valueByAttribute.get(attr.id)}`)
				.join(';')

			if (variantKeySet.has(variantKey)) {
				throw new BadRequestException(
					`Дублирующийся набор вариантных атрибутов: ${variantKey}`
				)
			}
			variantKeySet.add(variantKey)

			const sku = rawSku || this.buildVariantSku(baseSku ?? '', orderedAttributes, valueByAttribute, variantKey)
			if (!sku) {
				throw new BadRequestException('Не удалось сгенерировать SKU варианта')
			}
			if (skuSet.has(sku)) {
				throw new BadRequestException(`Дублирующийся SKU варианта: ${sku}`)
			}
			skuSet.add(sku)

			const status =
				input.status ??
				(input.isAvailable === false
					? stock > 0
						? ProductVariantStatus.DISABLED
						: ProductVariantStatus.OUT_OF_STOCK
					: stock > 0
						? ProductVariantStatus.ACTIVE
						: ProductVariantStatus.OUT_OF_STOCK)

			return {
				sku,
				variantKey,
				stock,
				price,
				status,
				attributes: preparedAttributes
			}
		})
	}

	private buildVariantSku(
		baseSku: string,
		orderedAttributes: VariantAttributeMeta[],
		valueByAttribute: Map<string, string>,
		variantKey: string
	): string {
		const segments = orderedAttributes.map(attr =>
			this.normalizeSkuSegment(valueByAttribute.get(attr.id) ?? '')
		)
		const candidate = [baseSku, ...segments].filter(Boolean).join('-')
		if (candidate.length <= SKU_MAX_LENGTH) return candidate

		return this.buildHashedSku(baseSku, variantKey)
	}

	private normalizeSkuSegment(value: string): string {
		const slug = slugify(value, { lower: false, strict: true })
		const cleaned = slug.replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '')
		return cleaned ? cleaned.toUpperCase() : 'X'
	}

	private buildHashedSku(baseSku: string, variantKey: string): string {
		const hash = createHash('sha1')
			.update(variantKey)
			.digest('hex')
			.slice(0, 8)
			.toUpperCase()
		const separator = baseSku ? '-' : ''
		const maxBaseLength = SKU_MAX_LENGTH - hash.length - separator.length
		const head = maxBaseLength > 0 ? baseSku.slice(0, maxBaseLength) : ''
		return `${head}${separator}${hash}`
	}

	private async loadVariantAttributes(typeId: string): Promise<VariantAttributeMeta[]> {
		return this.prisma.attribute.findMany({
			where: {
				typeId,
				deleteAt: null,
				isVariantAttribute: true
			},
			select: {
				id: true,
				key: true,
				displayOrder: true,
				dataType: true
			},
			orderBy: [{ displayOrder: 'asc' }, { key: 'asc' }]
		})
	}

	private async loadEnumValues(
		enumValueIds: string[]
	): Promise<Map<string, EnumValueMeta>> {
		if (!enumValueIds.length) return new Map()

		const values = await this.prisma.attributeEnumValue.findMany({
			where: { id: { in: enumValueIds }, deleteAt: null },
			select: { id: true, attributeId: true, value: true }
		})

		return new Map(values.map(value => [value.id, value]))
	}

	private async loadEnumValuesByAttribute(
		attributeIds: string[]
	): Promise<Map<string, Map<string, EnumValueMeta>>> {
		if (!attributeIds.length) return new Map()

		const values = await this.prisma.attributeEnumValue.findMany({
			where: { attributeId: { in: attributeIds }, deleteAt: null },
			select: { id: true, attributeId: true, value: true }
		})

		const result = new Map<string, Map<string, EnumValueMeta>>()
		for (const value of values) {
			let attributeMap = result.get(value.attributeId)
			if (!attributeMap) {
				attributeMap = new Map()
				result.set(value.attributeId, attributeMap)
			}
			attributeMap.set(value.value, value)
		}

		return result
	}
}

