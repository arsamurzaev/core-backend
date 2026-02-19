import { DataType } from '@generated/enums'
import { BadRequestException, Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

import { ProductAttributeValueDto } from './dto/requests/product-attribute.dto.req'

export type ProductAttributeValueData = {
	attributeId: string
	enumValueId?: string | null
	valueString?: string | null
	valueInteger?: number | null
	valueDecimal?: number | null
	valueBoolean?: boolean | null
	valueDateTime?: Date | null
}

type AttributeMeta = {
	id: string
	key: string
	dataType: DataType
	isRequired: boolean
	isVariantAttribute: boolean
	isHidden: boolean
}

@Injectable()
export class ProductAttributeBuilder {
	constructor(private readonly prisma: PrismaService) {}

	async buildForCreate(
		typeId: string,
		inputs?: ProductAttributeValueDto[]
	): Promise<ProductAttributeValueData[]> {
		return this.build(typeId, inputs ?? [], { requireAll: true })
	}

	async buildForUpdate(
		typeId: string,
		inputs: ProductAttributeValueDto[]
	): Promise<ProductAttributeValueData[]> {
		return this.build(typeId, inputs, { requireAll: false })
	}

	private async build(
		typeId: string,
		inputs: ProductAttributeValueDto[],
		options: { requireAll: boolean }
	): Promise<ProductAttributeValueData[]> {
		if (!inputs.length) {
			if (options.requireAll) {
				await this.assertRequiredAttributes(typeId, new Set<string>())
			}
			return []
		}

		const attributeIds = new Set<string>()
		for (const input of inputs) {
			if (attributeIds.has(input.attributeId)) {
				throw new BadRequestException(`Дубликат атрибута ${input.attributeId}`)
			}
			attributeIds.add(input.attributeId)
		}

		const attributes = await this.loadAttributes(typeId, attributeIds)
		const attributeMap = new Map(
			attributes.map(attribute => [attribute.id, attribute])
		)

		if (attributeMap.size !== attributeIds.size) {
			const missing = [...attributeIds].filter(id => !attributeMap.has(id))
			throw new BadRequestException(`Неизвестные атрибуты: ${missing.join(', ')}`)
		}

		for (const attribute of attributes) {
			if (attribute.isVariantAttribute) {
				throw new BadRequestException(
					`Атрибут ${attribute.key} является вариантным и не может быть назначен товару`
				)
			}
		}

		if (options.requireAll) {
			await this.assertRequiredAttributes(typeId, attributeIds)
		}

		const enumValueIds = [
			...new Set(
				inputs
					.filter(input => {
						const attribute = attributeMap.get(input.attributeId)
						return attribute?.dataType === DataType.ENUM
					})
					.map(input => input.enumValueId)
					.filter((value): value is string => Boolean(value))
			)
		]

		const enumValueMap = await this.loadEnumValues(enumValueIds)

		return inputs.map(input =>
			this.buildValue(input, attributeMap.get(input.attributeId), enumValueMap)
		)
	}

	private async loadAttributes(
		typeId: string,
		attributeIds: Set<string>
	): Promise<AttributeMeta[]> {
		if (attributeIds.size === 0) return []

		return this.prisma.attribute.findMany({
			where: {
				id: { in: [...attributeIds] },
				deleteAt: null,
				isHidden: false,
				types: { some: { id: typeId } }
			},
			select: {
				id: true,
				key: true,
				dataType: true,
				isRequired: true,
				isVariantAttribute: true,
				isHidden: true
			}
		})
	}

	private async assertRequiredAttributes(
		typeId: string,
		attributeIds: Set<string>
	): Promise<void> {
		const required = await this.prisma.attribute.findMany({
			where: {
				deleteAt: null,
				isHidden: false,
				isRequired: true,
				isVariantAttribute: false,
				types: { some: { id: typeId } }
			},
			select: { id: true, key: true }
		})

		const missing = required.filter(attribute => !attributeIds.has(attribute.id))
		if (missing.length) {
			throw new BadRequestException(
				`Отсутствуют обязательные атрибуты: ${missing
					.map(attribute => attribute.key)
					.join(', ')}`
			)
		}
	}

	private async loadEnumValues(
		enumValueIds: string[]
	): Promise<Map<string, string>> {
		if (!enumValueIds.length) return new Map()

		const values = await this.prisma.attributeEnumValue.findMany({
			where: { id: { in: enumValueIds }, deleteAt: null },
			select: { id: true, attributeId: true }
		})

		return new Map(values.map(value => [value.id, value.attributeId]))
	}

	private buildValue(
		input: ProductAttributeValueDto,
		attribute: AttributeMeta,
		enumValueMap: Map<string, string>
	): ProductAttributeValueData {
		const provided = this.getProvidedFields(input)

		if (provided.length !== 1) {
			throw new BadRequestException(
				`Атрибут ${attribute.key} должен содержать ровно одно значение`
			)
		}

		switch (attribute.dataType) {
			case DataType.STRING: {
				if (provided[0] !== 'valueString') {
					throw new BadRequestException(
						`Атрибут ${attribute.key} ожидает valueString`
					)
				}
				const value = (input.valueString ?? '').trim()
				if (!value) {
					throw new BadRequestException(
						`Атрибут ${attribute.key} не может быть пустым`
					)
				}
				return {
					attributeId: attribute.id,
					enumValueId: null,
					valueString: value,
					valueInteger: null,
					valueDecimal: null,
					valueBoolean: null,
					valueDateTime: null
				}
			}
			case DataType.INTEGER: {
				if (provided[0] !== 'valueInteger') {
					throw new BadRequestException(
						`Атрибут ${attribute.key} ожидает valueInteger`
					)
				}
				if (!Number.isInteger(input.valueInteger)) {
					throw new BadRequestException(
						`Атрибут ${attribute.key} должен быть целым числом`
					)
				}
				return {
					attributeId: attribute.id,
					enumValueId: null,
					valueString: null,
					valueInteger: input.valueInteger,
					valueDecimal: null,
					valueBoolean: null,
					valueDateTime: null
				}
			}
			case DataType.DECIMAL: {
				if (provided[0] !== 'valueDecimal') {
					throw new BadRequestException(
						`Атрибут ${attribute.key} ожидает valueDecimal`
					)
				}
				if (!Number.isFinite(input.valueDecimal)) {
					throw new BadRequestException(
						`Атрибут ${attribute.key} должен быть числом`
					)
				}
				return {
					attributeId: attribute.id,
					enumValueId: null,
					valueString: null,
					valueInteger: null,
					valueDecimal: input.valueDecimal,
					valueBoolean: null,
					valueDateTime: null
				}
			}
			case DataType.BOOLEAN: {
				if (provided[0] !== 'valueBoolean') {
					throw new BadRequestException(
						`Атрибут ${attribute.key} ожидает valueBoolean`
					)
				}
				return {
					attributeId: attribute.id,
					enumValueId: null,
					valueString: null,
					valueInteger: null,
					valueDecimal: null,
					valueBoolean: input.valueBoolean,
					valueDateTime: null
				}
			}
			case DataType.DATETIME: {
				if (provided[0] !== 'valueDateTime') {
					throw new BadRequestException(
						`Атрибут ${attribute.key} ожидает valueDateTime`
					)
				}
				const raw = input.valueDateTime?.trim()
				if (!raw) {
					throw new BadRequestException(
						`Для атрибута ${attribute.key} требуется дата/время`
					)
				}
				const date = new Date(raw)
				if (Number.isNaN(date.getTime())) {
					throw new BadRequestException(
						`Атрибут ${attribute.key} должен быть валидной датой/временем`
					)
				}
				return {
					attributeId: attribute.id,
					enumValueId: null,
					valueString: null,
					valueInteger: null,
					valueDecimal: null,
					valueBoolean: null,
					valueDateTime: date
				}
			}
			case DataType.ENUM: {
				if (provided[0] !== 'enumValueId') {
					throw new BadRequestException(
						`Атрибут ${attribute.key} ожидает enumValueId`
					)
				}
				const enumValueId = input.enumValueId?.trim()
				if (!enumValueId) {
					throw new BadRequestException(
						`Для атрибута ${attribute.key} требуется enumValueId`
					)
				}
				const ownerAttributeId = enumValueMap.get(enumValueId)
				if (!ownerAttributeId) {
					throw new BadRequestException(
						`Значение enum для атрибута ${attribute.key} не найдено`
					)
				}
				if (ownerAttributeId !== attribute.id) {
					throw new BadRequestException(
						`Значение enum ${enumValueId} не относится к атрибуту ${attribute.key}`
					)
				}
				return {
					attributeId: attribute.id,
					enumValueId,
					valueString: null,
					valueInteger: null,
					valueDecimal: null,
					valueBoolean: null,
					valueDateTime: null
				}
			}
			default:
				throw new BadRequestException(
					`Неподдерживаемый тип данных для атрибута ${attribute.key}`
				)
		}
	}

	private getProvidedFields(input: ProductAttributeValueDto): string[] {
		const provided: string[] = []

		if (input.enumValueId !== undefined && input.enumValueId !== null) {
			provided.push('enumValueId')
		}
		if (input.valueString !== undefined && input.valueString !== null) {
			provided.push('valueString')
		}
		if (input.valueInteger !== undefined && input.valueInteger !== null) {
			provided.push('valueInteger')
		}
		if (input.valueDecimal !== undefined && input.valueDecimal !== null) {
			provided.push('valueDecimal')
		}
		if (input.valueBoolean !== undefined && input.valueBoolean !== null) {
			provided.push('valueBoolean')
		}
		if (input.valueDateTime !== undefined && input.valueDateTime !== null) {
			provided.push('valueDateTime')
		}

		return provided
	}
}
