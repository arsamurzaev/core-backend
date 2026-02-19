import { ConfigService } from '@nestjs/config'
import { Test, TestingModule } from '@nestjs/testing'

import { AllInterfaces } from '@/core/config'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'

import { S3Service } from './s3.service'

describe('S3Service', () => {
	let service: S3Service

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				S3Service,
				{
					provide: ConfigService,
					useValue: {
						get: jest.fn().mockReturnValue({
							enabled: false,
							bucket: '',
							region: 'us-east-1',
							endpoint: null,
							publicUrl: null,
							forcePathStyle: false,
							publicRead: false,
							imageQuality: 82,
							imageVariants: [1600, 900, 400],
							imageFormats: ['webp', 'avif'],
							maxFileSizeMb: 10,
							storeOriginal: false,
							presignExpiresSec: 600
						} satisfies AllInterfaces['s3'])
					}
				},
				{
					provide: PrismaService,
					useValue: {
						media: { create: jest.fn() }
					}
				}
			]
		}).compile()

		service = module.get<S3Service>(S3Service)
	})

	it('should be defined', () => {
		expect(service).toBeDefined()
	})
})
