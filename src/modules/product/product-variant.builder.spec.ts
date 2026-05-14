import { DataType } from '@generated/enums'
import { Test, TestingModule } from '@nestjs/testing'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

import { ProductVariantBuilder } from './product-variant.builder'

describe('ProductVariantBuilder', () => {
	let builder: ProductVariantBuilder
	let prisma: {
		attribute: { findMany: jest.Mock }
		productTypeAttribute: { findMany: jest.Mock }
		attributeEnumValue: { findMany: jest.Mock }
	}

	beforeEach(async () => {
		prisma = {
			attribute: {
				findMany: jest.fn()
			},
			productTypeAttribute: {
				findMany: jest.fn()
			},
			attributeEnumValue: {
				findMany: jest.fn()
			}
		}

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				ProductVariantBuilder,
				{
					provide: PrismaService,
					useValue: prisma
				}
			]
		}).compile()

		builder = module.get(ProductVariantBuilder)
	})

	it('uses ProductTypeAttribute metadata when productTypeId is present', async () => {
		prisma.productTypeAttribute.findMany.mockResolvedValueOnce([
			{
				isRequired: true,
				displayOrder: 1,
				attribute: {
					id: 'attribute-1',
					key: 'size',
					dataType: DataType.ENUM
				}
			}
		])
		prisma.attributeEnumValue.findMany.mockResolvedValueOnce([
			{
				id: 'enum-1',
				attributeId: 'attribute-1',
				value: 's'
			}
		])

		await expect(
			builder.build(
				{ catalogTypeId: 'type-1', productTypeId: 'product-type-1' },
				[
					{
						price: 100,
						stock: 2,
						attributes: [
							{
								attributeId: 'attribute-1',
								enumValueId: 'enum-1'
							}
						]
					}
				],
				'SKU'
			)
		).resolves.toEqual([
			expect.objectContaining({
				sku: 'SKU-S',
				variantKey: 'size=s',
				price: 100,
				stock: 2
			})
		])

		expect(prisma.productTypeAttribute.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					productTypeId: 'product-type-1',
					isVariant: true
				})
			})
		)
		expect(prisma.attribute.findMany).not.toHaveBeenCalled()
	})

	it('persists attributes for disabled variants', async () => {
		prisma.productTypeAttribute.findMany.mockResolvedValueOnce([
			{
				isRequired: true,
				displayOrder: 1,
				attribute: {
					id: 'attribute-1',
					key: 'size',
					dataType: DataType.ENUM
				}
			}
		])
		prisma.attributeEnumValue.findMany.mockResolvedValueOnce([
			{
				id: 'enum-1',
				attributeId: 'attribute-1',
				value: 's'
			}
		])

		await expect(
			builder.build(
				{ catalogTypeId: 'type-1', productTypeId: 'product-type-1' },
				[
					{
						status: 'DISABLED',
						attributes: [
							{
								attributeId: 'attribute-1',
								enumValueId: 'enum-1'
							}
						]
					}
				],
				'SKU'
			)
		).resolves.toEqual([
			expect.objectContaining({
				status: 'DISABLED',
				variantKey: 'size=s',
				attributes: [{ attributeId: 'attribute-1', enumValueId: 'enum-1' }]
			})
		])
	})

	it('builds multi-attribute variants with default product price', async () => {
		prisma.productTypeAttribute.findMany.mockResolvedValueOnce([
			{
				isRequired: true,
				displayOrder: 1,
				attribute: {
					id: 'size-attribute',
					key: 'size',
					dataType: DataType.ENUM
				}
			},
			{
				isRequired: true,
				displayOrder: 2,
				attribute: {
					id: 'color-attribute',
					key: 'color',
					dataType: DataType.ENUM
				}
			}
		])
		prisma.attributeEnumValue.findMany.mockResolvedValueOnce([
			{
				id: 'size-m',
				attributeId: 'size-attribute',
				value: 'm'
			},
			{
				id: 'color-white',
				attributeId: 'color-attribute',
				value: 'white'
			}
		])

		await expect(
			builder.build(
				{ catalogTypeId: 'type-1', productTypeId: 'product-type-1' },
				[
					{
						stock: 4,
						attributes: [
							{
								attributeId: 'size-attribute',
								enumValueId: 'size-m'
							},
							{
								attributeId: 'color-attribute',
								enumValueId: 'color-white'
							}
						]
					}
				],
				'SKU',
				{ defaultPrice: 250 }
			)
		).resolves.toEqual([
			expect.objectContaining({
				sku: 'SKU-M-WHITE',
				variantKey: 'size=m;color=white',
				price: 250,
				stock: 4,
				attributes: [
					{ attributeId: 'size-attribute', enumValueId: 'size-m' },
					{ attributeId: 'color-attribute', enumValueId: 'color-white' }
				]
			})
		])
	})

	it('rejects duplicate multi-attribute combinations', async () => {
		prisma.productTypeAttribute.findMany.mockResolvedValueOnce([
			{
				isRequired: true,
				displayOrder: 1,
				attribute: {
					id: 'size-attribute',
					key: 'size',
					dataType: DataType.ENUM
				}
			},
			{
				isRequired: true,
				displayOrder: 2,
				attribute: {
					id: 'color-attribute',
					key: 'color',
					dataType: DataType.ENUM
				}
			}
		])
		prisma.attributeEnumValue.findMany.mockResolvedValueOnce([
			{
				id: 'size-m',
				attributeId: 'size-attribute',
				value: 'm'
			},
			{
				id: 'color-white',
				attributeId: 'color-attribute',
				value: 'white'
			}
		])

		await expect(
			builder.build(
				{ catalogTypeId: 'type-1', productTypeId: 'product-type-1' },
				[
					{
						attributes: [
							{
								attributeId: 'size-attribute',
								enumValueId: 'size-m'
							},
							{
								attributeId: 'color-attribute',
								enumValueId: 'color-white'
							}
						]
					},
					{
						attributes: [
							{
								attributeId: 'color-attribute',
								enumValueId: 'color-white'
							},
							{
								attributeId: 'size-attribute',
								enumValueId: 'size-m'
							}
						]
					}
				],
				'SKU',
				{ defaultPrice: 250 }
			)
		).rejects.toThrow('size=m;color=white')
	})

	it('rejects a variant attribute missing from the selected product type', async () => {
		prisma.productTypeAttribute.findMany.mockResolvedValueOnce([
			{
				isRequired: true,
				displayOrder: 1,
				attribute: {
					id: 'attribute-1',
					key: 'size',
					dataType: DataType.ENUM
				}
			}
		])

		await expect(
			builder.build(
				{ catalogTypeId: 'type-1', productTypeId: 'product-type-1' },
				[
					{
						price: 100,
						stock: 2,
						attributes: [
							{
								attributeId: 'attribute-outside-type',
								enumValueId: 'enum-1'
							}
						]
					}
				],
				'SKU'
			)
		).rejects.toThrow('attribute-outside-type')

		expect(prisma.attributeEnumValue.findMany).not.toHaveBeenCalled()
		expect(prisma.attribute.findMany).not.toHaveBeenCalled()
	})

	it('rejects a non-variant ProductTypeAttribute for variants', async () => {
		prisma.productTypeAttribute.findMany.mockResolvedValueOnce([])

		await expect(
			builder.build(
				{ catalogTypeId: 'type-1', productTypeId: 'product-type-1' },
				[
					{
						price: 100,
						stock: 2,
						attributes: [
							{
								attributeId: 'material-attribute',
								enumValueId: 'enum-1'
							}
						]
					}
				],
				'SKU'
			)
		).rejects.toThrow('У типа нет вариантных атрибутов')

		expect(prisma.productTypeAttribute.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					productTypeId: 'product-type-1',
					isVariant: true
				})
			})
		)
		expect(prisma.attribute.findMany).not.toHaveBeenCalled()
	})
})
