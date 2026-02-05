import { DataType } from '@generated/enums'
import {
	AttributeCreateInput,
	AttributeEnumValueCreateInput,
	AttributeEnumValueUpdateInput,
	AttributeUpdateInput
} from '@generated/models'
import {
	BadRequestException,
	Injectable,
	NotFoundException
} from '@nestjs/common'

import { AttributeRepository } from './attribute.repository'
import { CreateAttributeEnumDtoReq } from './dto/requests/create-attribute-enum.dto.req'
import { CreateAttributeDtoReq } from './dto/requests/create-attribute.dto.req'
import { UpdateAttributeEnumDtoReq } from './dto/requests/update-attribute-enum.dto.req'
import { UpdateAttributeDtoReq } from './dto/requests/update-attribute.dto.req'

function normalizeKey(value: string): string {
	return value.trim().toLowerCase()
}

function normalizeLabel(value: string): string {
	return value.trim()
}

function normalizeEnumValue(value: string): string {
	return value.trim().toLowerCase()
}

@Injectable()
export class AttributeService {
	constructor(private readonly repo: AttributeRepository) {}

	async getByType(typeId: string) {
		return this.repo.findByType(typeId, true)
	}

	async getById(id: string) {
		const attribute = await this.repo.findById(id, true)
		if (!attribute) throw new NotFoundException('Attribute not found')
		return attribute
	}

	async create(dto: CreateAttributeDtoReq) {
		this.ensureVariantRules(dto.dataType, dto.isVariantAttribute)

		const data: AttributeCreateInput = {
			key: normalizeKey(dto.key),
			displayName: normalizeLabel(dto.displayName),
			dataType: dto.dataType,
			isRequired: dto.isRequired ?? false,
			isVariantAttribute: dto.isVariantAttribute ?? false,
			isFilterable: dto.isFilterable ?? false,
			displayOrder: dto.displayOrder ?? 0,
			type: { connect: { id: dto.typeId } }
		}

		return this.repo.create(data)
	}

	async update(id: string, dto: UpdateAttributeDtoReq) {
		const data: AttributeUpdateInput = {}

		if (dto.key !== undefined) {
			data.key = normalizeKey(dto.key)
		}
		if (dto.displayName !== undefined) {
			data.displayName = normalizeLabel(dto.displayName)
		}
		if (dto.dataType !== undefined) {
			data.dataType = dto.dataType
		}
		if (dto.isRequired !== undefined) {
			data.isRequired = dto.isRequired
		}
		if (dto.isVariantAttribute !== undefined) {
			data.isVariantAttribute = dto.isVariantAttribute
		}
		if (dto.isFilterable !== undefined) {
			data.isFilterable = dto.isFilterable
		}
		if (dto.displayOrder !== undefined) {
			data.displayOrder = dto.displayOrder
		}

		if (Object.keys(data).length === 0) {
			throw new BadRequestException('No fields to update')
		}

		if (dto.dataType !== undefined || dto.isVariantAttribute !== undefined) {
			const current = await this.repo.findById(id)
			if (!current) throw new NotFoundException('Attribute not found')

			const nextType = dto.dataType ?? current.dataType
			const nextVariant = dto.isVariantAttribute ?? current.isVariantAttribute

			this.ensureVariantRules(nextType, nextVariant)
		}

		const attribute = await this.repo.update(id, data)
		if (!attribute) throw new NotFoundException('Attribute not found')

		return attribute
	}

	async remove(id: string) {
		const attribute = await this.repo.softDelete(id)
		if (!attribute) throw new NotFoundException('Attribute not found')

		return { ok: true }
	}

	async getEnumValues(attributeId: string) {
		await this.requireEnumAttribute(attributeId)
		return this.repo.findEnumValues(attributeId)
	}

	async createEnumValue(attributeId: string, dto: CreateAttributeEnumDtoReq) {
		await this.requireEnumAttribute(attributeId)

		const data: AttributeEnumValueCreateInput = {
			value: normalizeEnumValue(dto.value),
			displayName:
				dto.displayName === undefined ? null : normalizeLabel(dto.displayName),
			displayOrder: dto.displayOrder ?? 0,
			attribute: { connect: { id: attributeId } }
		}

		return this.repo.createEnumValue(data)
	}

	async updateEnumValue(
		attributeId: string,
		id: string,
		dto: UpdateAttributeEnumDtoReq
	) {
		await this.requireEnumAttribute(attributeId)

		const data: AttributeEnumValueUpdateInput = {}

		if (dto.value !== undefined) {
			data.value = normalizeEnumValue(dto.value)
		}
		if (dto.displayName !== undefined) {
			data.displayName = normalizeLabel(dto.displayName)
		}
		if (dto.displayOrder !== undefined) {
			data.displayOrder = dto.displayOrder
		}

		if (Object.keys(data).length === 0) {
			throw new BadRequestException('No fields to update')
		}

		const enumValue = await this.repo.updateEnumValue(id, attributeId, data)
		if (!enumValue) throw new NotFoundException('Enum value not found')

		return enumValue
	}

	async removeEnumValue(attributeId: string, id: string) {
		await this.requireEnumAttribute(attributeId)

		const enumValue = await this.repo.softDeleteEnumValue(id, attributeId)
		if (!enumValue) throw new NotFoundException('Enum value not found')

		return { ok: true }
	}

	private ensureVariantRules(dataType: DataType, isVariantAttribute?: boolean) {
		if (isVariantAttribute && dataType !== DataType.ENUM) {
			throw new BadRequestException('Variant attributes must use ENUM data type')
		}
	}

	private async requireEnumAttribute(attributeId: string) {
		const attribute = await this.repo.findById(attributeId)
		if (!attribute) throw new NotFoundException('Attribute not found')
		if (attribute.dataType !== DataType.ENUM) {
			throw new BadRequestException('Attribute is not ENUM')
		}
		return attribute
	}
}
