import { Prisma } from '@generated/client'
import {
	BadRequestException,
	Injectable,
	NotFoundException
} from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

import { type CartEntity, cartSelect } from './cart.selects'

@Injectable()
export class CartLookupService {
	constructor(private readonly prisma: PrismaService) {}

	async findByPublicKeyOrThrow(publicKey: string): Promise<CartEntity> {
		const normalized = publicKey.trim()
		if (!normalized) {
			throw new BadRequestException('Параметр publicKey обязателен')
		}

		const cart = await this.prisma.cart.findFirst({
			where: {
				deleteAt: null,
				publicKey: normalized
			},
			select: cartSelect
		})

		if (!cart) throw new NotFoundException('Корзина не найдена')

		return cart
	}

	async findByIdOrThrow(
		id: string,
		tx?: Prisma.TransactionClient
	): Promise<CartEntity> {
		const client = tx ?? this.prisma
		const cart = await client.cart.findFirst({
			where: { deleteAt: null, id },
			select: cartSelect
		})

		if (!cart) throw new NotFoundException('Корзина не найдена')

		return cart
	}
}
