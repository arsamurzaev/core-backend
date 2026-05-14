import { DataType } from '@generated/enums'
import { Test, TestingModule } from '@nestjs/testing'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

import { ProductAttributeBuilder } from './product-attribute.builder'

describe('ProductAttributeBuilder', () => {
	let builder: ProductAttributeBuilder
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
				ProductAttributeBuilder,
				{
					provide: PrismaService,
					useValue: prisma
				}
			]
		}).compile()

		builder = module.get(ProductAttributeBuilder)
	})

	it('allows creating a product without omitted empty attributes', async () => {
		await expect(builder.buildForCreate('type-1', [])).resolves.toEqual([])
		expect(prisma.attribute.findMany).not.toHaveBeenCalled()
	})

	it('does not require missing required attributes when create payload contains only filled ones', async () => {
		prisma.attribute.findMany.mockResolvedValueOnce([
			{
				id: 'attribute-1',
				key: 'title',
				dataType: DataType.STRING,
				isRequired: false,
				isVariantAttribute: false,
				isHidden: false
			}
		])

		await expect(
			builder.buildForCreate('type-1', [
				{
					attributeId: 'attribute-1',
					valueString: 'filled value'
				}
			])
		).resolves.toEqual([
			{
				attributeId: 'attribute-1',
				enumValueId: null,
				valueString: 'filled value',
				valueInteger: null,
				valueDecimal: null,
				valueBoolean: null,
				valueDateTime: null
			}
		])
		expect(prisma.attribute.findMany).toHaveBeenCalledTimes(1)
	})

	it('still rejects empty value for a provided attribute', async () => {
		prisma.attribute.findMany.mockResolvedValueOnce([
			{
				id: 'attribute-1',
				key: 'title',
				dataType: DataType.STRING,
				isRequired: true,
				isVariantAttribute: false,
				isHidden: false
			}
		])

		await expect(
			builder.buildForCreate('type-1', [
				{
					attributeId: 'attribute-1',
					valueString: '   '
				}
			])
		).rejects.toThrow('title')
	})

	it('uses ProductTypeAttribute metadata when productTypeId is present', async () => {
		prisma.productTypeAttribute.findMany.mockResolvedValueOnce([
			{
				isRequired: true,
				isVariant: false,
				attribute: {
					id: 'attribute-1',
					key: 'material',
					dataType: DataType.STRING,
					isHidden: false
				}
			}
		])

		await expect(
			builder.buildForCreate(
				{ catalogTypeId: 'type-1', productTypeId: 'product-type-1' },
				[
					{
						attributeId: 'attribute-1',
						valueString: 'Leather'
					}
				]
			)
		).resolves.toEqual([
			{
				attributeId: 'attribute-1',
				enumValueId: null,
				valueString: 'Leather',
				valueInteger: null,
				valueDecimal: null,
				valueBoolean: null,
				valueDateTime: null
			}
		])

		expect(prisma.productTypeAttribute.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					productTypeId: 'product-type-1'
				})
			})
		)
		expect(prisma.attribute.findMany).not.toHaveBeenCalled()
	})

	it('rejects removing required attributes by default', async () => {
		prisma.productTypeAttribute.findMany.mockResolvedValueOnce([
			{
				isRequired: true,
				isVariant: false,
				attribute: {
					id: 'attribute-1',
					key: 'material',
					dataType: DataType.STRING,
					isHidden: false
				}
			}
		])

		await expect(
			builder.prepareRemovedAttributeIdsForUpdate(
				{ catalogTypeId: 'type-1', productTypeId: 'product-type-1' },
				['attribute-1']
			)
		).rejects.toThrow('material')
	})

	it('allows removing required attributes when product type is being cleared', async () => {
		prisma.productTypeAttribute.findMany.mockResolvedValueOnce([
			{
				isRequired: true,
				isVariant: false,
				attribute: {
					id: 'attribute-1',
					key: 'material',
					dataType: DataType.STRING,
					isHidden: false
				}
			}
		])

		await expect(
			builder.prepareRemovedAttributeIdsForUpdate(
				{ catalogTypeId: 'type-1', productTypeId: 'product-type-1' },
				['attribute-1'],
				{ allowRequired: true }
			)
		).resolves.toEqual(['attribute-1'])
	})

	it('allows catalog attributes that are not part of the selected product type', async () => {
		prisma.productTypeAttribute.findMany.mockResolvedValueOnce([])
		prisma.attribute.findMany.mockResolvedValueOnce([
			{
				id: 'attribute-outside-type',
				key: 'material',
				dataType: DataType.STRING,
				isRequired: false,
				isVariantAttribute: false,
				isHidden: false
			}
		])

		await expect(
			builder.buildForCreate(
				{ catalogTypeId: 'type-1', productTypeId: 'product-type-1' },
				[
					{
						attributeId: 'attribute-outside-type',
						valueString: 'Leather'
					}
				]
			)
		).resolves.toEqual([
			{
				attributeId: 'attribute-outside-type',
				enumValueId: null,
				valueString: 'Leather',
				valueInteger: null,
				valueDecimal: null,
				valueBoolean: null,
				valueDateTime: null
			}
		])

		expect(prisma.productTypeAttribute.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					productTypeId: 'product-type-1',
					attributeId: { in: ['attribute-outside-type'] }
				})
			})
		)
		expect(prisma.attribute.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					id: { in: ['attribute-outside-type'] },
					types: { some: { id: 'type-1' } }
				})
			})
		)
	})

	it('rejects an attribute outside the product type and catalog type', async () => {
		prisma.productTypeAttribute.findMany.mockResolvedValueOnce([])
		prisma.attribute.findMany.mockResolvedValueOnce([])

		await expect(
			builder.buildForCreate(
				{ catalogTypeId: 'type-1', productTypeId: 'product-type-1' },
				[
					{
						attributeId: 'unknown-attribute',
						valueString: 'Leather'
					}
				]
			)
		).rejects.toThrow('unknown-attribute')
	})
})
