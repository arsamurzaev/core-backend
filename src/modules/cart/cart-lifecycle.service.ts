import { CartStatus, Prisma } from '@generated/client'
import { Injectable, NotFoundException } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import type { DomainEvent } from '@/shared/domain-events/domain-events.contract'

import { CartInventoryReservationService } from './cart-inventory-reservation.service'
import { type CartEntity, cartSelect } from './cart.selects'

export type DeleteCurrentCartResult =
	| {
			cartId: string
			deletedAt: Date
			mode: 'deleted'
			token: string
	  }
	| {
			cartId: string
			mode: 'detached'
			token: string
	  }

export type ExpireInactiveManagerSessionsResult = {
	pausedCarts: CartEntity[]
}

export type ExpireAbandonedDraftCartsResult = {
	expiredCount: number
}

@Injectable()
export class CartLifecycleService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly inventoryReservation: CartInventoryReservationService
	) {}

	async deleteCurrentCart(
		catalogId: string,
		token: string | null | undefined
	): Promise<DeleteCurrentCartResult> {
		const current = await this.findCurrentCartOrThrow(catalogId, token)
		const cart = current.cart

		if (cart.status === CartStatus.IN_PROGRESS || cart.assignedManagerId) {
			await this.prisma.cart.update({
				where: { id: cart.id },
				data: {
					token: null,
					userId: null
				}
			})

			return { cartId: cart.id, mode: 'detached', token: current.token }
		}

		const now = new Date()
		const releaseResult = await this.prisma.$transaction(async tx => {
			await tx.cartItem.updateMany({
				where: {
					cartId: cart.id,
					deleteAt: null
				},
				data: { deleteAt: now }
			})
			await tx.cart.update({
				where: { id: cart.id },
				data: {
					deleteAt: now,
					token: null,
					userId: null,
					publicKey: null,
					checkoutKey: null,
					checkoutMethod: null,
					checkoutData: Prisma.DbNull,
					checkoutContacts: Prisma.DbNull
				}
			})

			return this.inventoryReservation.releaseCartReservationsTx(tx, {
				catalogId,
				cartId: cart.id,
				reason: 'Cart deleted by customer',
				actorUserId: null,
				now
			})
		})

		await this.inventoryReservation.invalidateProductCaches(
			releaseResult.affectedCatalogIds,
			releaseResult.domainEvents
		)

		return {
			cartId: cart.id,
			deletedAt: now,
			mode: 'deleted',
			token: current.token
		}
	}

	async expireInactiveManagerSessions(
		inactivityMs: number
	): Promise<ExpireInactiveManagerSessionsResult> {
		const threshold = new Date(Date.now() - inactivityMs)
		const stale = await this.prisma.cart.findMany({
			where: {
				deleteAt: null,
				status: CartStatus.IN_PROGRESS,
				managerLastSeenAt: { lt: threshold }
			},
			select: { id: true }
		})

		if (!stale.length) return { pausedCarts: [] }

		const now = new Date()
		const staleIds = stale.map(cart => cart.id)

		await this.prisma.cart.updateMany({
			where: {
				id: { in: staleIds },
				status: CartStatus.IN_PROGRESS
			},
			data: {
				status: CartStatus.PAUSED,
				statusChangedAt: now
			}
		})

		const fresh = await this.prisma.cart.findMany({
			where: {
				id: { in: staleIds },
				deleteAt: null
			},
			select: cartSelect
		})

		return {
			pausedCarts: fresh.filter(cart => cart.status === CartStatus.PAUSED)
		}
	}

	async expireAbandonedDraftCarts(
		draftTtlMs: number
	): Promise<ExpireAbandonedDraftCartsResult> {
		const threshold = new Date(Date.now() - draftTtlMs)
		const stale = await this.prisma.cart.findMany({
			where: {
				deleteAt: null,
				status: { in: [CartStatus.DRAFT, CartStatus.SHARED] },
				updatedAt: { lt: threshold }
			},
			select: { id: true, catalogId: true }
		})

		if (!stale.length) return { expiredCount: 0 }

		const staleIds = stale.map(cart => cart.id)
		const now = new Date()
		const releaseEffects = await this.prisma.$transaction(async tx => {
			await tx.cart.updateMany({
				where: {
					id: { in: staleIds },
					status: { in: [CartStatus.DRAFT, CartStatus.SHARED] }
				},
				data: {
					status: CartStatus.EXPIRED,
					statusChangedAt: now
				}
			})

			const releasedCatalogIds = new Set<string>()
			const inventoryDomainEvents: DomainEvent[] = []
			for (const cart of stale) {
				const result = await this.inventoryReservation.releaseCartReservationsTx(
					tx,
					{
						catalogId: cart.catalogId,
						cartId: cart.id,
						reason: 'Cart expired',
						actorUserId: null,
						now
					}
				)
				for (const catalogId of result.affectedCatalogIds) {
					releasedCatalogIds.add(catalogId)
				}
				inventoryDomainEvents.push(...(result.domainEvents ?? []))
			}

			return {
				affectedCatalogIds: [...releasedCatalogIds],
				inventoryDomainEvents
			}
		})

		await this.inventoryReservation.invalidateProductCaches(
			releaseEffects.affectedCatalogIds,
			releaseEffects.inventoryDomainEvents
		)

		return { expiredCount: staleIds.length }
	}

	private async findCurrentCartOrThrow(
		catalogId: string,
		token: string | null | undefined
	): Promise<{ cart: CartEntity; token: string }> {
		const normalizedToken = token?.trim()
		if (!normalizedToken) {
			throw new NotFoundException('Корзина не найдена')
		}

		const cart = await this.prisma.cart.findFirst({
			where: {
				catalogId,
				token: normalizedToken,
				status: {
					in: [
						CartStatus.DRAFT,
						CartStatus.SHARED,
						CartStatus.IN_PROGRESS,
						CartStatus.PAUSED
					]
				},
				deleteAt: null
			},
			select: cartSelect
		})

		if (!cart) {
			throw new NotFoundException('Корзина не найдена')
		}

		return {
			cart,
			token: normalizedToken
		}
	}
}
