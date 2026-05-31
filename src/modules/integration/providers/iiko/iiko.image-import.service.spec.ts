import { IikoImageImportService } from './iiko.image-import.service'

describe('IikoImageImportService', () => {
	it('does not reimport images for an already illustrated product', async () => {
		const repo = createRepoMock()
		repo.findProductMediaIds.mockResolvedValue(['media-1'])
		const s3 = createS3Mock()
		const media = createMediaMock()
		const client = createClientMock()
		const service = new IikoImageImportService(
			repo as any,
			s3 as any,
			media as any
		)

		const result = await service.refreshProductImages({
			catalogId: 'catalog-1',
			productId: 'product-1',
			client: client as any,
			product: {
				id: 'iiko-product-1',
				imageLinks: ['https://cdn.example.test/pizza.jpg']
			} as any,
			forceImages: false
		})

		expect(result).toBe(0)
		expect(client.downloadImage).not.toHaveBeenCalled()
		expect(repo.replaceProductMedia).not.toHaveBeenCalled()
	})

	it('imports images once when the product has no media yet', async () => {
		const repo = createRepoMock()
		repo.findProductMediaIds.mockResolvedValue([])
		repo.replaceProductMedia.mockResolvedValue(true)
		const s3 = createS3Mock()
		s3.uploadImage.mockResolvedValue({
			mediaId: 'media-new',
			key: 'integrations/iiko/products/product-1.jpg'
		})
		const media = createMediaMock()
		const client = createClientMock()
		client.downloadImage.mockResolvedValue({
			buffer: Buffer.from('image'),
			contentType: 'image/png'
		})
		const service = new IikoImageImportService(
			repo as any,
			s3 as any,
			media as any
		)

		const result = await service.refreshProductImages({
			catalogId: 'catalog-1',
			productId: 'product-1',
			client: client as any,
			product: {
				id: 'iiko-product-1',
				imageLinks: ['https://cdn.example.test/pizza.jpg']
			} as any,
			forceImages: false
		})

		expect(result).toBe(1)
		expect(client.downloadImage).toHaveBeenCalledWith(
			'https://cdn.example.test/pizza.jpg'
		)
		expect(repo.replaceProductMedia).toHaveBeenCalledWith(
			'product-1',
			'catalog-1',
			['media-new'],
			undefined
		)
	})
})

function createRepoMock() {
	return {
		findProductMediaIds: jest.fn(),
		replaceProductMedia: jest.fn()
	}
}

function createS3Mock() {
	return {
		uploadImage: jest.fn(),
		deleteObjectsByKeys: jest.fn()
	}
}

function createMediaMock() {
	return {
		findOrphanedByIds: jest.fn().mockResolvedValue([]),
		deleteOrphanedByIds: jest.fn()
	}
}

function createClientMock() {
	return {
		downloadImage: jest.fn()
	}
}
