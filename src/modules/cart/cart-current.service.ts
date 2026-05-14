import { CartStatus } from '@generated/client'
import { Injectable, NotFoundException } from '@nestjs/common'
import { randomBytes } from 'node:crypto'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

import { type CartEntity, cartSelect } from './cart.selects'
import { CART_TOKEN_BYTES } from './cart.utils'

const CURRENT_CART_VISIBLE_STATUSES = [
	CartStatus.DRAFT,
	CartStatus.SHARED,
	CartStatus.IN_PROGRESS,
	CartStatus.PAUSED
] as const

export type CurrentCartResult = {
	cart: CartEntity
	isNew: boolean
	token: string
}

@Injectable()
export class CartCurrentService {
	constructor(private readonly prisma: PrismaService) {}

	async getOrCreate(
		catalogId: string,
		token?: string | null
	): Promise<CurrentCartResult> {
		const normalizedToken = token?.trim()
		if (normalizedToken) {
			const existing = await this.findByToken(catalogId, normalizedToken)
			if (existing) {
				return {
					cart: existing,
					isNew: false,
					token: normalizedToken
				}
			}
		}

		const newToken = await this.generateUniqueToken()
		const created = await this.prisma.cart.create({
			data: {
				catalogId,
				status: CartStatus.DRAFT,
				token: newToken
			},
			select: cartSelect
		})

		return { cart: created, isNew: true, token: newToken }
	}

	async getOrThrow(
		catalogId: string,
		token?: string | null
	): Promise<Omit<CurrentCartResult, 'isNew'>> {
		const normalizedToken = token?.trim()
		if (!normalizedToken) {
			throw new NotFoundException('Корзина не найдена')
		}

		const cart = await this.findByToken(catalogId, normalizedToken)
		if (!cart) {
			throw new NotFoundException('Корзина не найдена')
		}

		return { cart, token: normalizedToken }
	}

	findByToken(catalogId: string, token: string): Promise<CartEntity | null> {
		return this.prisma.cart.findFirst({
			where: {
				catalogId,
				deleteAt: null,
				status: { in: [...CURRENT_CART_VISIBLE_STATUSES] },
				token
			},
			select: cartSelect
		})
	}

	private async generateUniqueToken() {
		for (;;) {
			const candidate = randomBytes(CART_TOKEN_BYTES).toString('hex')
			const exists = await this.prisma.cart.findFirst({
				where: { token: candidate },
				select: { id: true }
			})
			if (!exists) return candidate
		}
	}
}
