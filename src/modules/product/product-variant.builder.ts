import { DataType, ProductVariantStatus } from '@generated/enums'
import { BadRequestException, Injectable } from '@nestjs/common'
import { createHash } from 'crypto'
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
	isRequired: boolean
}

type EnumValueMeta = {
	id: string
	attributeId: string
	value: string
}

type BuildOptions = {
	variantAttributeId?: string
	defaultPrice?: number
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
		productSku?: string,
		options: BuildOptions = {}
	): Promise<ProductVariantData[]> {
		const hasInputs = Boolean(inputs?.length)
		const variantAttributes = await this.loadVariantAttributes(typeId)
		if (!variantAttributes.length) {
			if (!hasInputs) return []
			throw new BadRequestException('У типа нет вариантных атрибутов')
		}

		const normalizedVariantAttributeId = options.variantAttributeId?.trim()
		const selectedAttribute = normalizedVariantAttributeId
			? variantAttributes.find(
					attribute => attribute.id === normalizedVariantAttributeId
				)
			: null

		if (normalizedVariantAttributeId && !selectedAttribute) {
			throw new BadRequestException(
				`Атрибут ${normalizedVariantAttributeId} не является вариантным для этого типа`
			)
		}

		const scopedAttributes = selectedAttribute
			? [selectedAttribute]
			: variantAttributes

		const orderedAttributes = [...scopedAttributes].sort((a, b) => {
			if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder
			return a.key.localeCompare(b.key)
		})

		const requiredVariantAttributes = scopedAttributes.filter(
			attribute => attribute.isRequired
		)
		if (!hasInputs) {
			if (requiredVariantAttributes.length > 0) {
				const keys = requiredVariantAttributes.map(attribute => attribute.key)
				throw new BadRequestException(
					`Для обязательных вариантных атрибутов нужны вариации: ${keys.join(', ')}`
				)
			}
			return []
		}
		const attributeMap = new Map(variantAttributes.map(attr => [attr.id, attr]))
		const requiredAttributeIds = new Set(
			requiredVariantAttributes.map(attr => attr.id)
		)
		const skuSet = new Set<string>()
		const enumValueIds = new Set<string>()
		const valueAttributeIds = new Set<string>()
		const baseSku = productSku?.trim() ?? ''
		const preparedInputs: {
			input: ProductVariantDtoReq
			status: ProductVariantStatus
		}[] = []

		for (const [index, input] of inputs.entries()) {
			const variantLabel = `варианта #${index + 1}`
			const stock = input.stock ?? 0
			const price = input.price ?? options.defaultPrice ?? 0
			const status = this.resolveStatus(input, stock)

			if (!Number.isInteger(stock) || stock < 0) {
				throw new BadRequestException(
					`Некорректное значение остатка для ${variantLabel}`
				)
			}
			if (!Number.isFinite(price) || price < 0) {
				throw new BadRequestException(`Некорректная цена для ${variantLabel}`)
			}

			if (!input.attributes?.length) {
				throw new BadRequestException(`Для ${variantLabel} не заданы атрибуты`)
			}
			if (selectedAttribute && input.attributes.length !== 1) {
				throw new BadRequestException(
					`Для ${variantLabel} нужно указать ровно один атрибут`
				)
			}

			preparedInputs.push({ input, status })

			const providedIds = new Set<string>()

			for (const attr of input.attributes ?? []) {
				const attributeId = attr.attributeId?.trim()
				const enumValueId = attr.enumValueId?.trim()
				const valueLabel = attr.value?.trim()
				const hasEnumValueId = Boolean(enumValueId)
				const hasValue = Boolean(valueLabel)
				if (!attributeId) {
					throw new BadRequestException(
						`Для ${variantLabel} обязательно поле attributeId`
					)
				}
				if (!hasEnumValueId && !hasValue) {
					throw new BadRequestException(
						`Для ${variantLabel} нужно указать enumValueId или value`
					)
				}
				if (hasEnumValueId && hasValue) {
					throw new BadRequestException(
						`Для ${variantLabel} нельзя одновременно указывать enumValueId и value`
					)
				}

				const meta = attributeMap.get(attributeId)
				if (!meta) {
					throw new BadRequestException(
						`Атрибут ${attributeId} не является вариантным`
					)
				}
				if (selectedAttribute && meta.id !== selectedAttribute.id) {
					throw new BadRequestException(
						`Для вариаций разрешён только атрибут ${selectedAttribute.key}`
					)
				}
				if (meta.dataType !== DataType.ENUM) {
					throw new BadRequestException(
						`Вариантный атрибут ${meta.key} должен быть типа ENUM`
					)
				}
				if (providedIds.has(attributeId)) {
					throw new BadRequestException(
						`Дубликат атрибута ${meta.key} в ${variantLabel}`
					)
				}

				providedIds.add(attributeId)
				if (hasEnumValueId) {
					enumValueIds.add(enumValueId)
				} else {
					valueAttributeIds.add(attributeId)
				}
			}

			if (requiredAttributeIds.size) {
				const missing = [...requiredAttributeIds]
					.filter(id => !providedIds.has(id))
					.map(id => attributeMap.get(id)?.key ?? id)
				if (missing.length) {
					throw new BadRequestException(
						`Не указаны значения для атрибутов: ${missing.join(', ')}`
					)
				}
			}
		}
		const enumValueMap = await this.loadEnumValues([...enumValueIds])
		const enumValuesByAttribute = await this.loadEnumValuesByAttribute([
			...valueAttributeIds
		])
		const variantKeySet = new Set<string>()

		return preparedInputs.map(({ input, status }) => {
			const valueByAttribute = new Map<string, string>()
			const preparedAttributes: ProductVariantAttributeInput[] = []
			const shouldPersistAttributes = status !== ProductVariantStatus.DISABLED

			for (const attr of input.attributes ?? []) {
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
					if (shouldPersistAttributes) {
						preparedAttributes.push({ attributeId, enumValueId })
					}
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
				if (shouldPersistAttributes) {
					preparedAttributes.push({
						attributeId,
						value: normalizedValue,
						displayName: normalizeEnumLabel(valueLabel)
					})
				}
			}

			const usedAttributes = orderedAttributes.filter(attr =>
				valueByAttribute.has(attr.id)
			)
			const variantKey = usedAttributes
				.map(attr => `${attr.key}=${valueByAttribute.get(attr.id)}`)
				.join(';')

			if (variantKeySet.has(variantKey)) {
				throw new BadRequestException(
					`Дублирующийся набор вариантных атрибутов: ${variantKey}`
				)
			}
			variantKeySet.add(variantKey)

			const sku = this.buildVariantSku(
				baseSku,
				usedAttributes,
				valueByAttribute,
				variantKey
			)
			if (!sku) {
				throw new BadRequestException('Не удалось сгенерировать SKU варианта')
			}
			if (skuSet.has(sku)) {
				throw new BadRequestException(`Дублирующийся SKU варианта: ${sku}`)
			}
			skuSet.add(sku)

			const stock = input.stock ?? 0
			const price = input.price ?? options.defaultPrice ?? 0

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

	private async loadVariantAttributes(
		typeId: string
	): Promise<VariantAttributeMeta[]> {
		return this.prisma.attribute.findMany({
			where: {
				deleteAt: null,
				isVariantAttribute: true,
				types: { some: { id: typeId } }
			},
			select: {
				id: true,
				key: true,
				displayOrder: true,
				dataType: true,
				isRequired: true
			},
			orderBy: [{ displayOrder: 'asc' }, { key: 'asc' }]
		})
	}

	private resolveStatus(
		input: ProductVariantDtoReq,
		stock: number
	): ProductVariantStatus {
		if (input.status) return input.status
		if (input.isAvailable === false) {
			return stock > 0
				? ProductVariantStatus.DISABLED
				: ProductVariantStatus.OUT_OF_STOCK
		}
		return stock > 0
			? ProductVariantStatus.ACTIVE
			: ProductVariantStatus.OUT_OF_STOCK
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
