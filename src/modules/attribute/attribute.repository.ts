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
	typeId: true,
	key: true,
	displayName: true,
	dataType: true,
	isRequired: true,
	isVariantAttribute: true,
	isFilterable: true,
	displayOrder: true,
	createdAt: true,
	updatedAt: true
}

const enumValueSelect = {
	id: true,
	attributeId: true,
	value: true,
	displayName: true,
	displayOrder: true,
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
			where: { typeId: resolvedTypeId, deleteAt: null },
			select: withEnums ? attributeSelectWithEnums : attributeSelect,
			orderBy: [{ displayOrder: 'asc' }, { key: 'asc' }]
		})
	}

	create(data: AttributeCreateInput) {
		return this.prisma.attribute.create({ data, select: attributeSelect })
	}

	async update(id: string, data: AttributeUpdateInput) {
		const result = await this.prisma.attribute.updateMany({
			where: { id, deleteAt: null },
			data
		})
		if (!result.count) return null

		return this.prisma.attribute.findFirst({
			where: { id, deleteAt: null },
			select: attributeSelect
		})
	}

	async softDelete(id: string) {
		const result = await this.prisma.attribute.updateMany({
			where: { id, deleteAt: null },
			data: { deleteAt: new Date() }
		})
		if (!result.count) return null

		return this.prisma.attribute.findFirst({
			where: { id },
			select: attributeSelect
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

	async existsKey(typeId: string, key: string): Promise<boolean> {
		const attribute = await this.prisma.attribute.findFirst({
			where: { typeId, key },
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
