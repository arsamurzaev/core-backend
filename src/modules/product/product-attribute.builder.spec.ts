import { DataType } from '@generated/enums'
import { Test, TestingModule } from '@nestjs/testing'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

import { ProductAttributeBuilder } from './product-attribute.builder'

describe('ProductAttributeBuilder', () => {
	let builder: ProductAttributeBuilder
	let prisma: {
		attribute: { findMany: jest.Mock }
		attributeEnumValue: { findMany: jest.Mock }
	}

	beforeEach(async () => {
		prisma = {
			attribute: {
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
		).rejects.toThrow('Атрибут title не может быть пустым')
	})
})
