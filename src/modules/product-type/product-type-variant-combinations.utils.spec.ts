import { DataType } from '@generated/enums'
import { BadRequestException } from '@nestjs/common'

import { assertProductTypeVariantCombinations } from './product-type-variant-combinations.utils'

describe('product type variant combinations utils', () => {
	const productType = {
		attributes: [
			{
				attributeId: 'color-attribute-id',
				isVariant: true,
				isRequired: false,
				displayOrder: 0,
				attribute: {
					id: 'color-attribute-id',
					key: 'color',
					dataType: DataType.ENUM
				}
			},
			{
				attributeId: 'size-attribute-id',
				isVariant: true,
				isRequired: true,
				displayOrder: 1,
				attribute: {
					id: 'size-attribute-id',
					key: 'size',
					dataType: DataType.ENUM
				}
			},
			{
				attributeId: 'material-attribute-id',
				isVariant: false,
				isRequired: false,
				displayOrder: 2,
				attribute: {
					id: 'material-attribute-id',
					key: 'material',
					dataType: DataType.STRING
				}
			}
		]
	}

	it('allows unique combinations for enum variant attributes', () => {
		expect(() =>
			assertProductTypeVariantCombinations(productType, [
				{
					attributes: [
						{ attributeId: 'size-attribute-id', enumValueId: 'size-s' },
						{ attributeId: 'color-attribute-id', enumValueId: 'color-black' }
					]
				},
				{
					attributes: [
						{ attributeId: 'size-attribute-id', enumValueId: 'size-m' },
						{ attributeId: 'color-attribute-id', enumValueId: 'color-black' }
					]
				}
			])
		).not.toThrow()
	})

	it('detects duplicate combinations regardless of attribute order', () => {
		const assertDuplicateCombination = () =>
			assertProductTypeVariantCombinations(productType, [
				{
					attributes: [
						{ attributeId: 'size-attribute-id', enumValueId: 'size-s' },
						{ attributeId: 'color-attribute-id', enumValueId: 'color-black' }
					]
				},
				{
					attributes: [
						{ attributeId: 'color-attribute-id', enumValueId: 'color-black' },
						{ attributeId: 'size-attribute-id', enumValueId: 'size-s' }
					]
				}
			])

		expect(assertDuplicateCombination).toThrow(BadRequestException)
		expect(assertDuplicateCombination).toThrow(
			'Duplicate variant attribute combination'
		)
	})

	it('rejects combinations missing required variant attributes', () => {
		expect(() =>
			assertProductTypeVariantCombinations(productType, [
				{
					attributes: [
						{ attributeId: 'color-attribute-id', enumValueId: 'color-black' }
					]
				}
			])
		).toThrow('Missing required variant attributes: size')
	})

	it('rejects non-enum variant attributes from the product type', () => {
		expect(() =>
			assertProductTypeVariantCombinations(
				{
					attributes: [
						{
							attributeId: 'material-attribute-id',
							isVariant: true,
							isRequired: true,
							displayOrder: 0,
							attribute: {
								id: 'material-attribute-id',
								key: 'material',
								dataType: DataType.STRING
							}
						}
					]
				},
				[]
			)
		).toThrow('Variant product type attributes must use ENUM data type: material')
	})
})
