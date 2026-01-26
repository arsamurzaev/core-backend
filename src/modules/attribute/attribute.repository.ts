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

@Injectable()
export class AttributeRepository {
	constructor(private readonly prisma: PrismaService) {}

	findById(id: string, withEnums = false) {
		return this.prisma.attribute.findFirst({
			where: { id, deleteAt: null },
			select: withEnums ? attributeSelectWithEnums : attributeSelect
		})
	}

	findByType(typeId: string, withEnums = false) {
		return this.prisma.attribute.findMany({
			where: { typeId, deleteAt: null },
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
