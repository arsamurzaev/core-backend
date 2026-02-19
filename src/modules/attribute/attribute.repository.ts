import {
	AttributeCreateInput,
	AttributeEnumValueCreateInput,
	AttributeEnumValueUpdateInput,
	AttributeUpdateInput
} from '@generated/models'
import { Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

const attributeSelect = {
	id: true,
	key: true,
	displayName: true,
	dataType: true,
	isRequired: true,
	isVariantAttribute: true,
	isFilterable: true,
	displayOrder: true,
	isHidden: true,
	createdAt: true,
	updatedAt: true,
	types: {
		select: { id: true }
	}
}

const enumValueSelect = {
	id: true,
	attributeId: true,
	value: true,
	displayName: true,
	displayOrder: true,
	businessId: true,
	createdAt: true,
	updatedAt: true
}

const attributeSelectWithEnums = {
	...attributeSelect,
	enumValues: {
		where: { deleteAt: null },
		select: enumValueSelect,
		orderBy: [{ displayOrder: 'asc' }, { value: 'asc' }]
	}
}

const uuidRegex =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

@Injectable()
export class AttributeRepository {
	constructor(private readonly prisma: PrismaService) {}

	private normalizeTypeKey(value: string) {
		return value.trim().toLowerCase()
	}

	private isUuid(value: string) {
		return uuidRegex.test(value)
	}

	private async resolveTypeId(value: string) {
		const normalized = value.trim()
		if (this.isUuid(normalized)) return normalized

		const type = await this.prisma.type.findUnique({
			where: { code: this.normalizeTypeKey(normalized) },
			select: { id: true }
		})

		return type?.id ?? null
	}

	findById(id: string, withEnums = false) {
		return this.prisma.attribute.findFirst({
			where: { id, deleteAt: null },
			select: withEnums ? attributeSelectWithEnums : attributeSelect
		})
	}

	async findByType(typeId: string, withEnums = false) {
		const resolvedTypeId = await this.resolveTypeId(typeId)
		if (!resolvedTypeId) return []

		return this.prisma.attribute.findMany({
			where: {
				deleteAt: null,
				types: { some: { id: resolvedTypeId } }
			},
			select: withEnums ? attributeSelectWithEnums : attributeSelect,
			orderBy: [{ displayOrder: 'asc' }, { key: 'asc' }]
		})
	}

	create(data: AttributeCreateInput) {
		return this.prisma.attribute.create({ data, select: attributeSelect })
	}

	async update(id: string, data: AttributeUpdateInput, typeIds?: string[]) {
		return this.prisma.$transaction(async tx => {
			const hasData = Object.keys(data).length > 0
			if (hasData) {
				const result = await tx.attribute.updateMany({
					where: { id, deleteAt: null },
					data
				})
				if (!result.count) return null
			} else {
				const existing = await tx.attribute.findFirst({
					where: { id, deleteAt: null },
					select: { id: true }
				})
				if (!existing) return null
			}

			if (typeIds) {
				await tx.attribute.update({
					where: { id },
					data: {
						types: {
							set: typeIds.map(typeId => ({ id: typeId }))
						}
					}
				})
			}

			return tx.attribute.findFirst({
				where: { id, deleteAt: null },
				select: attributeSelect
			})
		})
	}

	async softDelete(id: string) {
		return this.prisma.$transaction(async tx => {
			const attribute = await tx.attribute.findFirst({
				where: { id, deleteAt: null },
				select: attributeSelect
			})
			if (!attribute) return null

			const now = new Date()

			await tx.attribute.update({
				where: { id },
				data: { deleteAt: now }
			})

			await tx.attributeEnumValue.updateMany({
				where: { attributeId: id, deleteAt: null },
				data: { deleteAt: now }
			})

			await tx.productAttribute.updateMany({
				where: { attributeId: id, deleteAt: null },
				data: { deleteAt: now }
			})

			if (attribute.isVariantAttribute) {
				await tx.productVariant.updateMany({
					where: {
						deleteAt: null,
						attributes: { some: { attributeId: id, deleteAt: null } }
					},
					data: { deleteAt: now }
				})

				await tx.variantAttribute.updateMany({
					where: { attributeId: id, deleteAt: null },
					data: { deleteAt: now }
				})
			}

			return attribute
		})
	}

	findEnumValues(attributeId: string) {
		return this.prisma.attributeEnumValue.findMany({
			where: { attributeId, deleteAt: null },
			select: enumValueSelect,
			orderBy: [{ displayOrder: 'asc' }, { value: 'asc' }]
		})
	}

	createEnumValue(data: AttributeEnumValueCreateInput) {
		return this.prisma.attributeEnumValue.create({
			data,
			select: enumValueSelect
		})
	}

	async existsKey(
		typeId: string,
		key: string,
		excludeId?: string
	): Promise<boolean> {
		const attribute = await this.prisma.attribute.findFirst({
			where: {
				key,
				deleteAt: null,
				types: { some: { id: typeId } },
				...(excludeId ? { id: { not: excludeId } } : {})
			},
			select: { id: true }
		})
		return Boolean(attribute)
	}

	async existsKeyInTypes(
		typeIds: string[],
		key: string,
		excludeId?: string
	): Promise<boolean> {
		if (!typeIds.length) return false
		const attribute = await this.prisma.attribute.findFirst({
			where: {
				key,
				deleteAt: null,
				types: { some: { id: { in: typeIds } } },
				...(excludeId ? { id: { not: excludeId } } : {})
			},
			select: { id: true }
		})
		return Boolean(attribute)
	}

	async existsEnumValue(attributeId: string, value: string): Promise<boolean> {
		const enumValue = await this.prisma.attributeEnumValue.findFirst({
			where: { attributeId, value },
			select: { id: true }
		})
		return Boolean(enumValue)
	}

	async updateEnumValue(
		id: string,
		attributeId: string,
		data: AttributeEnumValueUpdateInput
	) {
		const result = await this.prisma.attributeEnumValue.updateMany({
			where: { id, attributeId, deleteAt: null },
			data
		})
		if (!result.count) return null

		return this.prisma.attributeEnumValue.findFirst({
			where: { id, attributeId },
			select: enumValueSelect
		})
	}

	async softDeleteEnumValue(id: string, attributeId: string) {
		const result = await this.prisma.attributeEnumValue.updateMany({
			where: { id, attributeId, deleteAt: null },
			data: { deleteAt: new Date() }
		})
		if (!result.count) return null

		return this.prisma.attributeEnumValue.findFirst({
			where: { id, attributeId },
			select: enumValueSelect
		})
	}
}
