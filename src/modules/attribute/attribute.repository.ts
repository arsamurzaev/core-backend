import type { Prisma } from '@generated/client'
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
	catalogId: true,
	value: true,
	displayName: true,
	displayOrder: true,
	businessId: true,
	source: true,
	mergedIntoId: true,
	aliases: {
		where: { deleteAt: null },
		select: {
			id: true,
			attributeId: true,
			catalogId: true,
			enumValueId: true,
			value: true,
			displayName: true,
			createdAt: true,
			updatedAt: true
		},
		orderBy: [{ value: 'asc' }]
	},
	createdAt: true,
	updatedAt: true
}

const enumValueDuplicateSelect = {
	id: true,
	attributeId: true,
	catalogId: true,
	value: true,
	displayName: true
}

const enumValueAliasSelect = {
	id: true,
	attributeId: true,
	catalogId: true,
	enumValueId: true,
	value: true,
	displayName: true,
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

function buildEnumValueWhere(
	catalogId?: string | null
): Prisma.AttributeEnumValueWhereInput {
	return {
		deleteAt: null,
		...(catalogId ? { catalogId } : {})
	}
}

function buildEnumValueAliasWhere(
	catalogId?: string | null
): Prisma.AttributeEnumValueAliasWhereInput {
	return {
		deleteAt: null,
		...(catalogId ? { catalogId } : {})
	}
}

function buildAttributeSelectWithEnums(catalogId?: string | null) {
	return {
		...attributeSelect,
		enumValues: {
			where: buildEnumValueWhere(catalogId),
			select: enumValueSelect,
			orderBy: [{ displayOrder: 'asc' as const }, { value: 'asc' as const }]
		}
	}
}

const uuidRegex =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const attributeIdSelect = {
	id: true
}

function buildActiveAttributeWhere(id: string) {
	return { id, deleteAt: null }
}

function hasAttributeUpdateData(data: AttributeUpdateInput): boolean {
	return Object.keys(data).length > 0
}

function buildTypeSet(typeIds: string[]) {
	return typeIds.map(typeId => ({ id: typeId }))
}

type AttributeMutationTx = Pick<
	Prisma.TransactionClient,
	| 'attribute'
	| 'attributeEnumValue'
	| 'productAttribute'
	| 'productVariant'
	| 'variantAttribute'
>

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

	findById(
		id: string,
		withEnums = false,
		catalogId?: string | null
	): Promise<any> {
		return this.prisma.attribute.findFirst({
			where: buildActiveAttributeWhere(id),
			select: (withEnums
				? buildAttributeSelectWithEnums(catalogId)
				: attributeSelect) as any
		})
	}

	async findByType(
		typeId: string,
		withEnums = false,
		catalogId?: string | null
	): Promise<any[]> {
		const resolvedTypeId = await this.resolveTypeId(typeId)
		if (!resolvedTypeId) return []

		return this.prisma.attribute.findMany({
			where: {
				deleteAt: null,
				types: { some: { id: resolvedTypeId } }
			},
			select: (withEnums
				? buildAttributeSelectWithEnums(catalogId)
				: attributeSelect) as any,
			orderBy: [{ displayOrder: 'asc' }, { key: 'asc' }]
		})
	}

	create(data: AttributeCreateInput): Promise<any> {
		return this.prisma.attribute.create({ data, select: attributeSelect })
	}

	async update(
		id: string,
		data: AttributeUpdateInput,
		typeIds?: string[]
	): Promise<any> {
		return this.prisma.$transaction(async tx => {
			const exists = await this.ensureAttributeReadyForUpdate(tx, id, data)
			if (!exists) return null

			await this.syncAttributeTypes(tx, id, typeIds)
			return this.findActiveAttributeInTx(tx, id)
		})
	}

	async softDelete(id: string): Promise<any> {
		return this.prisma.$transaction(async tx => {
			const attribute = await this.findActiveAttributeInTx(tx, id)
			if (!attribute) return null

			const now = new Date()
			await this.markAttributeDeleted(tx, id, now)
			await this.markRelatedEnumValuesDeleted(tx, id, now)
			await this.markRelatedProductAttributesDeleted(tx, id, now)

			if (attribute.isVariantAttribute) {
				await this.markRelatedVariantsDeleted(tx, id, now)
				await this.markRelatedVariantAttributesDeleted(tx, id, now)
			}

			return attribute
		})
	}

	findEnumValues(
		attributeId: string,
		catalogId?: string | null
	): Promise<any[]> {
		return this.prisma.attributeEnumValue.findMany({
			where: { attributeId, ...buildEnumValueWhere(catalogId) },
			select: enumValueSelect as any,
			orderBy: [{ displayOrder: 'asc' }, { value: 'asc' }]
		})
	}

	findEnumValue(
		attributeId: string,
		id: string,
		catalogId?: string | null
	): Promise<any> {
		return this.prisma.attributeEnumValue.findFirst({
			where: { id, attributeId, ...buildEnumValueWhere(catalogId) },
			select: enumValueSelect as any
		})
	}

	createEnumValue(data: AttributeEnumValueCreateInput): Promise<any> {
		return this.prisma.attributeEnumValue.create({
			data: data as any,
			select: enumValueSelect as any
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

	async findExistingTypeIds(typeIds: string[]): Promise<string[]> {
		if (!typeIds.length) return []
		const types = await this.prisma.type.findMany({
			where: { id: { in: typeIds } },
			select: { id: true }
		})
		return types.map(type => type.id)
	}

	async existsEnumValue(
		attributeId: string,
		value: string,
		catalogId?: string | null
	): Promise<boolean> {
		const enumValue = await this.prisma.attributeEnumValue.findFirst({
			where: { attributeId, value, ...(catalogId ? { catalogId } : {}) },
			select: { id: true }
		})
		return Boolean(enumValue)
	}

	async findEnumValueDuplicate(
		attributeId: string,
		value: string,
		excludeId?: string,
		catalogId?: string | null
	): Promise<any> {
		const enumValue = await this.prisma.attributeEnumValue.findFirst({
			where: {
				attributeId,
				value,
				deleteAt: null,
				...(catalogId ? { catalogId } : {}),
				...(excludeId ? { id: { not: excludeId } } : {})
			},
			select: enumValueDuplicateSelect as any
		})
		if (enumValue) return { ...enumValue, matchType: 'value' }

		const alias = await (this.prisma as any).attributeEnumValueAlias.findFirst({
			where: {
				attributeId,
				value,
				deleteAt: null,
				...(catalogId ? { catalogId } : {}),
				enumValue: {
					deleteAt: null,
					...(catalogId ? { catalogId } : {}),
					...(excludeId ? { id: { not: excludeId } } : {})
				}
			},
			select: {
				enumValue: { select: enumValueDuplicateSelect },
				value: true
			}
		})

		return alias?.enumValue ? { ...alias.enumValue, matchType: 'alias' } : null
	}

	async updateEnumValue(
		id: string,
		attributeId: string,
		data: AttributeEnumValueUpdateInput,
		catalogId?: string | null
	): Promise<any> {
		const result = await this.prisma.attributeEnumValue.updateMany({
			where: { id, attributeId, ...buildEnumValueWhere(catalogId) },
			data: data as any
		})
		if (!result.count) return null

		return this.findEnumValueById(id, attributeId, catalogId)
	}

	findEnumValueAliases(
		attributeId: string,
		enumValueId: string,
		catalogId?: string | null
	): Promise<any[]> {
		return (this.prisma as any).attributeEnumValueAlias.findMany({
			where: {
				attributeId,
				enumValueId,
				...buildEnumValueAliasWhere(catalogId)
			},
			select: enumValueAliasSelect,
			orderBy: [{ value: 'asc' }]
		})
	}

	createEnumValueAlias(data: {
		attributeId: string
		catalogId?: string | null
		enumValueId: string
		value: string
		displayName: string | null
	}): Promise<any> {
		return (this.prisma as any).attributeEnumValueAlias.create({
			data,
			select: enumValueAliasSelect
		})
	}

	async softDeleteEnumValueAlias(
		attributeId: string,
		enumValueId: string,
		aliasId: string,
		catalogId?: string | null
	): Promise<any> {
		const result = await (this.prisma as any).attributeEnumValueAlias.updateMany({
			where: {
				id: aliasId,
				attributeId,
				enumValueId,
				...buildEnumValueAliasWhere(catalogId)
			},
			data: { deleteAt: new Date() }
		})
		if (!result.count) return null

		return (this.prisma as any).attributeEnumValueAlias.findFirst({
			where: { id: aliasId, attributeId, enumValueId },
			select: enumValueAliasSelect
		})
	}

	async mergeEnumValues(
		attributeId: string,
		sourceId: string,
		targetId: string,
		catalogId?: string | null
	): Promise<any> {
		return this.prisma.$transaction(async tx => {
			const source = (await tx.attributeEnumValue.findFirst({
				where: { id: sourceId, attributeId, ...buildEnumValueWhere(catalogId) },
				select: enumValueSelect as any
			})) as any
			if (!source) return null

			const target = (await tx.attributeEnumValue.findFirst({
				where: { id: targetId, attributeId, ...buildEnumValueWhere(catalogId) },
				select: enumValueSelect as any
			})) as any
			if (!target) return null

			const now = new Date()
			await tx.productAttribute.updateMany({
				where: {
					attributeId,
					enumValueId: sourceId,
					deleteAt: null,
					...(catalogId ? { product: { catalogId } } : {})
				},
				data: { enumValueId: targetId }
			})
			await tx.variantAttribute.updateMany({
				where: {
					attributeId,
					enumValueId: sourceId,
					deleteAt: null,
					...(catalogId ? { variant: { product: { catalogId } } } : {})
				},
				data: { enumValueId: targetId }
			})

			await this.moveEnumValueAliases(
				tx,
				attributeId,
				sourceId,
				targetId,
				now,
				catalogId
			)

			await tx.attributeEnumValue.update({
				where: { id: sourceId },
				data: { deleteAt: now, mergedIntoId: targetId } as any
			})
			await this.ensureMergedValueAlias(
				tx,
				attributeId,
				targetId,
				source.value,
				source.displayName,
				now,
				catalogId
			)

			return tx.attributeEnumValue.findFirst({
				where: { id: targetId, attributeId, ...buildEnumValueWhere(catalogId) },
				select: enumValueSelect as any
			})
		})
	}

	async softDeleteEnumValue(
		id: string,
		attributeId: string,
		catalogId?: string | null
	): Promise<any> {
		const result = await this.prisma.attributeEnumValue.updateMany({
			where: { id, attributeId, ...buildEnumValueWhere(catalogId) },
			data: { deleteAt: new Date() }
		})
		if (!result.count) return null

		return this.findEnumValueById(id, attributeId, catalogId)
	}

	private async ensureAttributeReadyForUpdate(
		tx: AttributeMutationTx,
		id: string,
		data: AttributeUpdateInput
	): Promise<boolean> {
		if (hasAttributeUpdateData(data)) {
			const result = await tx.attribute.updateMany({
				where: buildActiveAttributeWhere(id),
				data
			})
			return result.count > 0
		}

		const existing = await tx.attribute.findFirst({
			where: buildActiveAttributeWhere(id),
			select: attributeIdSelect
		})
		return Boolean(existing)
	}

	private async syncAttributeTypes(
		tx: AttributeMutationTx,
		id: string,
		typeIds?: string[]
	): Promise<void> {
		if (!typeIds) return

		await tx.attribute.update({
			where: { id },
			data: {
				types: {
					set: buildTypeSet(typeIds)
				}
			}
		})
	}

	private findActiveAttributeInTx(tx: AttributeMutationTx, id: string) {
		return tx.attribute.findFirst({
			where: buildActiveAttributeWhere(id),
			select: attributeSelect
		})
	}

	private markAttributeDeleted(
		tx: AttributeMutationTx,
		id: string,
		deleteAt: Date
	) {
		return tx.attribute.update({
			where: { id },
			data: { deleteAt }
		})
	}

	private markRelatedEnumValuesDeleted(
		tx: AttributeMutationTx,
		attributeId: string,
		deleteAt: Date
	) {
		return tx.attributeEnumValue.updateMany({
			where: { attributeId, deleteAt: null },
			data: { deleteAt }
		})
	}

	private markRelatedProductAttributesDeleted(
		tx: AttributeMutationTx,
		attributeId: string,
		deleteAt: Date
	) {
		return tx.productAttribute.updateMany({
			where: { attributeId, deleteAt: null },
			data: { deleteAt }
		})
	}

	private markRelatedVariantsDeleted(
		tx: AttributeMutationTx,
		attributeId: string,
		deleteAt: Date
	) {
		return tx.productVariant.updateMany({
			where: {
				deleteAt: null,
				attributes: { some: { attributeId, deleteAt: null } }
			},
			data: { deleteAt }
		})
	}

	private markRelatedVariantAttributesDeleted(
		tx: AttributeMutationTx,
		attributeId: string,
		deleteAt: Date
	) {
		return tx.variantAttribute.updateMany({
			where: { attributeId, deleteAt: null },
			data: { deleteAt }
		})
	}

	private findEnumValueById(
		id: string,
		attributeId: string,
		catalogId?: string | null
	) {
		return this.prisma.attributeEnumValue.findFirst({
			where: { id, attributeId, ...(catalogId ? { catalogId } : {}) },
			select: enumValueSelect as any
		})
	}

	private async moveEnumValueAliases(
		tx: AttributeMutationTx,
		attributeId: string,
		sourceId: string,
		targetId: string,
		deleteAt: Date,
		catalogId?: string | null
	): Promise<void> {
		const aliases = await (tx as any).attributeEnumValueAlias.findMany({
			where: {
				attributeId,
				enumValueId: sourceId,
				...buildEnumValueAliasWhere(catalogId)
			},
			select: { id: true, value: true }
		})

		for (const alias of aliases) {
			const conflict = await (tx as any).attributeEnumValueAlias.findFirst({
				where: {
					attributeId,
					enumValueId: targetId,
					value: alias.value,
					...buildEnumValueAliasWhere(catalogId)
				},
				select: { id: true }
			})

			if (conflict) {
				await (tx as any).attributeEnumValueAlias.update({
					where: { id: alias.id },
					data: { deleteAt }
				})
				continue
			}

			await (tx as any).attributeEnumValueAlias.update({
				where: { id: alias.id },
				data: { enumValueId: targetId }
			})
		}
	}

	private async ensureMergedValueAlias(
		tx: AttributeMutationTx,
		attributeId: string,
		targetId: string,
		value: string,
		displayName: string | null,
		deleteAt: Date,
		catalogId?: string | null
	): Promise<void> {
		const enumValueConflict = await tx.attributeEnumValue.findFirst({
			where: { attributeId, value, ...buildEnumValueWhere(catalogId) },
			select: { id: true }
		})
		if (enumValueConflict && enumValueConflict.id !== targetId) return

		const aliasConflict = await (tx as any).attributeEnumValueAlias.findFirst({
			where: { attributeId, value, ...buildEnumValueAliasWhere(catalogId) },
			select: { id: true, enumValueId: true }
		})
		if (aliasConflict?.enumValueId === targetId) return
		if (aliasConflict) {
			await (tx as any).attributeEnumValueAlias.update({
				where: { id: aliasConflict.id },
				data: { deleteAt }
			})
		}

		await (tx as any).attributeEnumValueAlias.create({
			data: {
				attributeId,
				catalogId: catalogId ?? null,
				enumValueId: targetId,
				value,
				displayName
			},
			select: { id: true }
		})
	}
}
