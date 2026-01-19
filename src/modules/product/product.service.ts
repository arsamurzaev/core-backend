import { Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

import { ProductRepository } from './product.repository'

@Injectable()
export class ProductService {
	constructor(
		private readonly repo: ProductRepository,
		private readonly prisma: PrismaService
	) {}
}
