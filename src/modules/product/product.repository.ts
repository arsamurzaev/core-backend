import { ProductCreateInput, ProductUpdateInput } from '@generated/models'
import { Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

import type { ProductAttributeValueData } from './product-attribute.builder'

const productSelect = {
	id: true,
	sku: true,
	name: true,
	slug: true,
	price: true,
	imagesUrls: true,
	isPopular: true,
	status: true,
	position: true,
	createdAt: true,
	updatedAt: true
}

const productAttributeSelect = {
	id: true,
	attributeId: true,
	enumValueId: true,
	valueString: true,
	valueInteger: true,
	valueDecimal: true,
	valueBoolean: true,
	attribute: {
		select: {
			id: true,
			key: true,
			displayName: true,
			dataType: true,
			isRequired: true,
			isVariantAttribute: true,
			isFilterable: true,
			displayOrder: true
		}
	},
	enumValue: {
		select: {
			id: true,
			value: true,
			displayName: true,
			displayOrder: true
		}
	}
}

const productSelectWithAttributes = {
	...productSelect,
	productAttributes: {
		where: { deleteAt: null },
		select: productAttributeSelect,
		orderBy: { attributeId: 'asc' as const }
	}
}

@Injectable()
export class ProductRepository {
	constructor(private readonly prisma: PrismaService) {}

	findAll(catalogId: string) {
		return this.prisma.product.findMany({
			where: { deleteAt: null, catalogId },
			select: productSelect,
			orderBy: { createdAt: 'desc' }
		})
	}

	findById(id: string, catalogId: string) {
		return this.prisma.product.findFirst({
			where: { id, catalogId, deleteAt: null },
			select: productSelectWithAttributes
		})
	}

	findBySlug(slug: string, catalogId: string) {
		return this.prisma.product.findFirst({
			where: { slug, catalogId, deleteAt: null },
			select: productSelectWithAttributes
		})
	}

	create(data: ProductCreateInput, attributes?: ProductAttributeValueData[]) {
		if (!attributes?.length) {
			return this.prisma.product.create({ data, select: productSelect })
		}

		return this.prisma.$transaction(async tx => {
			const product = await tx.product.create({
				data,
				select: productSelect
			})

			await tx.productAttribute.createMany({
				data: attributes.map(attribute => ({
					...attribute,
					productId: product.id
				}))
			})

			return product
		})
	}

	async update(
		id: string,
		data: ProductUpdateInput,
		catalogId: string,
		attributes?: ProductAttributeValueData[]
	) {
		if (!attributes) {
			const result = await this.prisma.product.updateMany({
				where: { id, catalogId, deleteAt: null },
				data
			})
			if (!result.count) return null

			return this.prisma.product.findFirst({
				where: { id, catalogId, deleteAt: null },
				select: productSelectWithAttributes
			})
		}

		return this.prisma.$transaction(async tx => {
			const hasData = Object.keys(data).length > 0
			if (hasData) {
				const result = await tx.product.updateMany({
					where: { id, catalogId, deleteAt: null },
					data
				})
				if (!result.count) return null
			} else {
				const existing = await tx.product.findFirst({
					where: { id, catalogId, deleteAt: null },
					select: { id: true }
				})
				if (!existing) return null
			}

			for (const attribute of attributes) {
				await tx.productAttribute.upsert({
					where: {
						productId_attributeId: {
							productId: id,
							attributeId: attribute.attributeId
						}
					},
					create: {
						...attribute,
						productId: id
					},
					update: {
						...attribute,
						deleteAt: null
					}
				})
			}

			return tx.product.findFirst({
				where: { id, catalogId, deleteAt: null },
				select: productSelectWithAttributes
			})
		})
	}

	async softDelete(id: string, catalogId: string) {
		const result = await this.prisma.product.updateMany({
			where: { id, catalogId, deleteAt: null },
			data: { deleteAt: new Date() }
		})
		if (!result.count) return null

		return this.prisma.product.findFirst({
			where: { id, catalogId },
			select: productSelect
		})
	}
}
