import { CartStatus, CartTableSessionStatus, Prisma } from '@generated/client'
import {
	BadRequestException,
	Injectable,
	NotFoundException
} from '@nestjs/common'

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

export type CloseHallTableSessionResult = {
	cart: CartEntity
}

export type ExpireStaleHallTableSessionsResult = {
	expiredCount: number
	expiredCarts: CartEntity[]
}

type ClosableHallTableSessionStatus = Extract<
	CartTableSessionStatus,
	'CLOSED' | 'CANCELLED'
>

const ACTIVE_HALL_TABLE_SESSION_STATUSES = [
	CartTableSessionStatus.OPEN,
	CartTableSessionStatus.PENDING_CONFIRMATION
] as const

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
				updatedAt: { lt: threshold },
				tableSession: null
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

	async closeHallTableSession(
		cart: CartEntity,
		sessionStatus: ClosableHallTableSessionStatus,
		actorUserId: string | null
	): Promise<CloseHallTableSessionResult> {
		const session = cart.tableSession
		if (!session) {
			throw new BadRequestException('hall table session is not found')
		}

		if (!this.isActiveHallTableSessionStatus(session.status)) {
			throw new BadRequestException('hall table session is not active')
		}

		const now = new Date()
		const result = await this.prisma.$transaction(async tx => {
			const sessionUpdate = await tx.cartTableSession.updateMany({
				where: {
					id: session.id,
					status: { in: [...ACTIVE_HALL_TABLE_SESSION_STATUSES] },
					deleteAt: null
				},
				data: {
					status: sessionStatus,
					activeKey: null,
					closedAt: now
				}
			})
			if (!sessionUpdate.count) {
				throw new BadRequestException('hall table session is not active')
			}

			const cartUpdate = await tx.cart.updateMany({
				where: {
					id: cart.id,
					deleteAt: null,
					status: {
						notIn: [CartStatus.CONVERTED, CartStatus.CANCELLED, CartStatus.EXPIRED]
					}
				},
				data: {
					status: CartStatus.CANCELLED,
					statusChangedAt: now,
					closedAt: now,
					assignedManagerId: null,
					managerLastSeenAt: null,
					publicKey: null,
					checkoutKey: null
				}
			})
			if (!cartUpdate.count) {
				throw new BadRequestException('Cart is already closed')
			}

			const releaseEffect =
				await this.inventoryReservation.releaseCartReservationsTx(tx, {
					catalogId: cart.catalogId,
					cartId: cart.id,
					reason:
						sessionStatus === CartTableSessionStatus.CLOSED
							? 'Hall table session closed'
							: 'Hall table session reset',
					actorUserId,
					now
				})

			const fresh = await tx.cart.findFirst({
				where: { id: cart.id, deleteAt: null },
				select: cartSelect
			})
			if (!fresh) {
				throw new NotFoundException('Cart not found')
			}

			return { cart: fresh, releaseEffect }
		})

		await this.inventoryReservation.invalidateProductCaches(
			result.releaseEffect.affectedCatalogIds,
			result.releaseEffect.domainEvents
		)

		return { cart: result.cart }
	}

	async expireStaleHallTableSessions(
		tableSessionTtlMs: number
	): Promise<ExpireStaleHallTableSessionsResult> {
		const threshold = new Date(Date.now() - tableSessionTtlMs)
		const stale = await this.prisma.cartTableSession.findMany({
			where: {
				deleteAt: null,
				status: { in: [...ACTIVE_HALL_TABLE_SESSION_STATUSES] },
				cart: {
					deleteAt: null,
					status: {
						in: [CartStatus.SHARED, CartStatus.IN_PROGRESS, CartStatus.PAUSED]
					},
					updatedAt: { lt: threshold }
				}
			},
			select: {
				id: true,
				cartId: true,
				catalogId: true
			}
		})

		if (!stale.length) return { expiredCount: 0, expiredCarts: [] }

		const now = new Date()
		const sessionIds = stale.map(session => session.id)
		const cartIds = [...new Set(stale.map(session => session.cartId))]
		const releaseEffects = await this.prisma.$transaction(async tx => {
			await tx.cartTableSession.updateMany({
				where: {
					id: { in: sessionIds },
					status: { in: [...ACTIVE_HALL_TABLE_SESSION_STATUSES] }
				},
				data: {
					status: CartTableSessionStatus.EXPIRED,
					activeKey: null,
					closedAt: now
				}
			})

			await tx.cart.updateMany({
				where: {
					id: { in: cartIds },
					deleteAt: null,
					status: {
						in: [CartStatus.SHARED, CartStatus.IN_PROGRESS, CartStatus.PAUSED]
					}
				},
				data: {
					status: CartStatus.EXPIRED,
					statusChangedAt: now,
					closedAt: now,
					assignedManagerId: null,
					managerLastSeenAt: null,
					publicKey: null,
					checkoutKey: null
				}
			})

			const releasedCatalogIds = new Set<string>()
			const inventoryDomainEvents: DomainEvent[] = []
			for (const session of stale) {
				const releaseEffect =
					await this.inventoryReservation.releaseCartReservationsTx(tx, {
						catalogId: session.catalogId,
						cartId: session.cartId,
						reason: 'Hall table session expired',
						actorUserId: null,
						now
					})
				for (const catalogId of releaseEffect.affectedCatalogIds) {
					releasedCatalogIds.add(catalogId)
				}
				inventoryDomainEvents.push(...(releaseEffect.domainEvents ?? []))
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

		const expiredCarts = await this.prisma.cart.findMany({
			where: {
				id: { in: cartIds },
				deleteAt: null
			},
			select: cartSelect
		})

		return {
			expiredCount: stale.length,
			expiredCarts: expiredCarts.filter(cart => cart.status === CartStatus.EXPIRED)
		}
	}

	private isActiveHallTableSessionStatus(status: CartTableSessionStatus) {
		return ACTIVE_HALL_TABLE_SESSION_STATUSES.some(active => active === status)
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
