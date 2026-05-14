import { DataType } from '@generated/enums'
import { BadRequestException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { CacheService } from '@/shared/cache/cache.service'

import { AttributeRepository } from './attribute.repository'
import { AttributeService } from './attribute.service'

describe('AttributeService', () => {
	let service: AttributeService
	let repo: jest.Mocked<AttributeRepository>

	const enumAttribute = {
		id: 'attribute-id',
		dataType: DataType.ENUM,
		types: [{ id: 'type-id' }]
	}

	beforeEach(async () => {
		const repoMock = {
			findById: jest.fn(),
			findByType: jest.fn(),
			create: jest.fn(),
			update: jest.fn(),
			softDelete: jest.fn(),
			findEnumValues: jest.fn(),
			findEnumValue: jest.fn(),
			createEnumValue: jest.fn(),
			updateEnumValue: jest.fn(),
			softDeleteEnumValue: jest.fn(),
			existsEnumValue: jest.fn(),
			findEnumValueDuplicate: jest.fn(),
			findEnumValueAliases: jest.fn(),
			createEnumValueAlias: jest.fn(),
			softDeleteEnumValueAlias: jest.fn(),
			mergeEnumValues: jest.fn(),
			findExistingTypeIds: jest.fn(),
			existsKeyInTypes: jest.fn()
		}
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				AttributeService,
				{
					provide: AttributeRepository,
					useValue: repoMock
				},
				{
					provide: CacheService,
					useValue: { bumpVersion: jest.fn() }
				}
			]
		}).compile()

		service = module.get<AttributeService>(AttributeService)
		repo = module.get(AttributeRepository)
	})

	it('should be defined', () => {
		expect(service).toBeDefined()
	})

	it('creates an attribute for an existing catalog type', async () => {
		repo.findExistingTypeIds.mockResolvedValue(['type-id'])
		repo.existsKeyInTypes.mockResolvedValue(false)
		repo.create.mockResolvedValue({
			id: 'attribute-id',
			key: 'size',
			displayName: 'Size',
			dataType: DataType.ENUM,
			types: [{ id: 'type-id' }]
		} as any)

		await service.create({
			typeIds: ['type-id'],
			displayName: 'Size',
			dataType: DataType.ENUM,
			isVariantAttribute: true
		})

		expect(repo.create).toHaveBeenCalledWith(
			expect.objectContaining({
				displayName: 'Size',
				dataType: DataType.ENUM,
				types: { connect: [{ id: 'type-id' }] }
			})
		)
	})

	it('rejects product type ids passed as legacy catalog type ids', async () => {
		repo.findExistingTypeIds.mockResolvedValue([])

		await expect(
			service.create({
				typeIds: ['product-type-id'],
				displayName: 'Size',
				dataType: DataType.ENUM,
				isVariantAttribute: true
			})
		).rejects.toBeInstanceOf(BadRequestException)

		expect(repo.create).not.toHaveBeenCalled()
	})

	it('sets source when creating an enum value', async () => {
		repo.findById.mockResolvedValue(enumAttribute as any)
		repo.findEnumValueDuplicate.mockResolvedValue(null)
		repo.createEnumValue.mockResolvedValue({ id: 'enum-id' } as any)

		await service.createEnumValue('attribute-id', {
			value: 'imported-black',
			displayName: 'Imported black',
			source: 'IMPORTED'
		})

		expect(repo.createEnumValue).toHaveBeenCalledWith(
			expect.objectContaining({
				value: 'imported-black',
				source: 'IMPORTED'
			})
		)
	})

	it('rejects enum value duplicates found by alias', async () => {
		repo.findById.mockResolvedValue(enumAttribute as any)
		repo.findEnumValueDuplicate.mockResolvedValue({
			id: 'existing-id',
			value: 'black',
			matchType: 'alias'
		} as any)

		await expect(
			service.createEnumValue('attribute-id', { value: 'black' })
		).rejects.toBeInstanceOf(BadRequestException)
		expect(repo.createEnumValue).not.toHaveBeenCalled()
	})

	it('checks generated enum value base before adding suffixes', async () => {
		repo.findById.mockResolvedValue(enumAttribute as any)
		repo.findEnumValueDuplicate.mockResolvedValue({
			id: 'existing-id',
			value: 'black',
			matchType: 'value'
		} as any)

		await expect(
			service.createEnumValue('attribute-id', { displayName: 'Black' })
		).rejects.toBeInstanceOf(BadRequestException)
		expect(repo.existsEnumValue).not.toHaveBeenCalled()
		expect(repo.createEnumValue).not.toHaveBeenCalled()
	})

	it('creates enum value aliases after duplicate guard', async () => {
		repo.findById.mockResolvedValue(enumAttribute as any)
		repo.findEnumValue.mockResolvedValue({ id: 'enum-id' } as any)
		repo.findEnumValueDuplicate.mockResolvedValue(null)
		repo.createEnumValueAlias.mockResolvedValue({ id: 'alias-id' } as any)

		await service.createEnumValueAlias('attribute-id', 'enum-id', {
			value: '  Black   XL  ',
			displayName: 'Black XL'
		})

		expect(repo.createEnumValueAlias).toHaveBeenCalledWith({
			attributeId: 'attribute-id',
			catalogId: null,
			enumValueId: 'enum-id',
			value: 'black xl',
			displayName: 'Black XL'
		})
	})

	it('merges enum values through repository and rejects self-merge', async () => {
		repo.findById.mockResolvedValue(enumAttribute as any)
		repo.mergeEnumValues.mockResolvedValue({ id: 'target-id' } as any)

		await expect(
			service.mergeEnumValues('attribute-id', 'source-id', {
				targetId: 'source-id'
			})
		).rejects.toBeInstanceOf(BadRequestException)

		await service.mergeEnumValues('attribute-id', 'source-id', {
			targetId: 'target-id'
		})

		expect(repo.mergeEnumValues).toHaveBeenCalledWith(
			'attribute-id',
			'source-id',
			'target-id',
			null
		)
	})
})
