import { CartStatus, Prisma, Role } from '@generated/client'
import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	NotFoundException
} from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import type { SessionUser } from '@/modules/auth/types/auth-request'

import { CartInventoryReservationService } from './cart-inventory-reservation.service'
import { type CartEntity, cartSelect } from './cart.selects'

const TERMINAL_CART_STATUSES = new Set<CartStatus>([
	CartStatus.CONVERTED,
	CartStatus.CANCELLED,
	CartStatus.EXPIRED
])

export type CartManagerSessionResult = {
	cart: CartEntity
	statusChanged: boolean
}

@Injectable()
export class CartManagerSessionService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly inventoryReservation: CartInventoryReservationService
	) {}

	async begin(
		publicKey: string,
		user: SessionUser
	): Promise<CartManagerSessionResult> {
		const cart = await this.findManageableCartByPublicKeyOrThrow(publicKey, user)
		this.ensureCartIsOpen(cart.status)
		this.ensureManagerCanTakeCart(cart, user)

		const now = new Date()
		const statusChanged =
			cart.status !== CartStatus.IN_PROGRESS || cart.assignedManagerId !== user.id

		const result = await this.prisma.$transaction(async tx => {
			await tx.cart.update({
				where: { id: cart.id },
				data: {
					status: CartStatus.IN_PROGRESS,
					statusChangedAt: statusChanged ? now : cart.statusChangedAt,
					assignedManagerId: user.id,
					managerSessionStartedAt:
						cart.status === CartStatus.IN_PROGRESS &&
						cart.assignedManagerId === user.id &&
						cart.managerSessionStartedAt
							? cart.managerSessionStartedAt
							: now,
					managerLastSeenAt: now
				}
			})

			const updated = await this.findByIdOrThrow(cart.id, tx)
			const reserveEffect =
				await this.inventoryReservation.reserveCartStockIfNeededTx(
					tx,
					updated,
					user.id
				)

			return {
				cart: reserveEffect.reserved
					? await this.findByIdOrThrow(cart.id, tx)
					: updated,
				inventoryCacheCatalogIds: reserveEffect.inventoryCacheCatalogIds,
				inventoryDomainEvents: reserveEffect.inventoryDomainEvents
			}
		})

		await this.inventoryReservation.invalidateProductCaches(
			result.inventoryCacheCatalogIds,
			result.inventoryDomainEvents
		)

		return {
			cart: result.cart,
			statusChanged
		}
	}

	async heartbeat(
		publicKey: string,
		user: SessionUser
	): Promise<CartManagerSessionResult> {
		const cart = await this.findManageableCartByPublicKeyOrThrow(publicKey, user)
		this.ensureCartIsOpen(cart.status)
		this.ensureManagerCanRefreshPresence(cart, user)

		const now = new Date()
		const statusChanged =
			cart.status !== CartStatus.IN_PROGRESS || cart.assignedManagerId !== user.id

		const result = await this.prisma.$transaction(async tx => {
			await tx.cart.update({
				where: { id: cart.id },
				data: {
					status: CartStatus.IN_PROGRESS,
					statusChangedAt: statusChanged ? now : cart.statusChangedAt,
					assignedManagerId: user.id,
					managerSessionStartedAt:
						cart.status === CartStatus.IN_PROGRESS &&
						cart.assignedManagerId === user.id &&
						cart.managerSessionStartedAt
							? cart.managerSessionStartedAt
							: now,
					managerLastSeenAt: now
				}
			})

			const updated = await this.findByIdOrThrow(cart.id, tx)
			const reserveEffect =
				await this.inventoryReservation.reserveCartStockIfNeededTx(
					tx,
					updated,
					user.id
				)

			return {
				cart: reserveEffect.reserved
					? await this.findByIdOrThrow(cart.id, tx)
					: updated,
				inventoryCacheCatalogIds: reserveEffect.inventoryCacheCatalogIds,
				inventoryDomainEvents: reserveEffect.inventoryDomainEvents
			}
		})

		await this.inventoryReservation.invalidateProductCaches(
			result.inventoryCacheCatalogIds,
			result.inventoryDomainEvents
		)

		return {
			cart: result.cart,
			statusChanged
		}
	}

	async release(
		publicKey: string,
		user: SessionUser
	): Promise<CartManagerSessionResult> {
		const cart = await this.findManageableCartByPublicKeyOrThrow(publicKey, user)
		this.ensureCartIsOpen(cart.status)
		this.ensureManagerCanRefreshPresence(cart, user)

		const now = new Date()
		const statusChanged =
			cart.status !== CartStatus.PAUSED || cart.assignedManagerId !== user.id

		await this.prisma.cart.update({
			where: { id: cart.id },
			data: {
				status: CartStatus.PAUSED,
				statusChangedAt: statusChanged ? now : cart.statusChangedAt,
				assignedManagerId: user.id,
				managerSessionStartedAt: cart.managerSessionStartedAt ?? now,
				managerLastSeenAt: now
			}
		})

		return {
			cart: await this.findByIdOrThrow(cart.id),
			statusChanged
		}
	}

	async findManageableCartByPublicKeyOrThrow(
		publicKey: string,
		user: SessionUser
	): Promise<CartEntity> {
		const cart = await this.findByPublicKeyOrThrow(publicKey)
		await this.ensureManagerOwnsCatalog(cart.catalogId, user)
		return cart
	}

	private async findByPublicKeyOrThrow(publicKey: string): Promise<CartEntity> {
		const normalized = publicKey.trim()
		if (!normalized) {
			throw new BadRequestException('Параметр publicKey обязателен')
		}

		const cart = await this.prisma.cart.findFirst({
			where: {
				publicKey: normalized,
				deleteAt: null
			},
			select: cartSelect
		})

		if (!cart) throw new NotFoundException('Корзина не найдена')

		return cart
	}

	private async findByIdOrThrow(
		id: string,
		tx?: Prisma.TransactionClient
	): Promise<CartEntity> {
		const client = tx ?? this.prisma
		const cart = await client.cart.findFirst({
			where: { id, deleteAt: null },
			select: cartSelect
		})

		if (!cart) throw new NotFoundException('Корзина не найдена')

		return cart
	}

	private ensureCartIsOpen(status: CartStatus) {
		if (TERMINAL_CART_STATUSES.has(status)) {
			throw new BadRequestException('Корзина уже закрыта')
		}
	}

	private ensureManagerCanTakeCart(cart: CartEntity, user: SessionUser) {
		if (
			cart.status === CartStatus.IN_PROGRESS &&
			cart.assignedManagerId &&
			cart.assignedManagerId !== user.id &&
			user.role !== Role.ADMIN
		) {
			throw new ForbiddenException('Эту корзину уже обрабатывает другой менеджер')
		}
	}

	private ensureManagerCanRefreshPresence(cart: CartEntity, user: SessionUser) {
		if (
			cart.assignedManagerId &&
			cart.assignedManagerId !== user.id &&
			user.role !== Role.ADMIN
		) {
			throw new ForbiddenException('Корзина закреплена за другим менеджером')
		}
	}

	private async ensureManagerOwnsCatalog(
		catalogId: string,
		user: SessionUser
	): Promise<void> {
		if (user.role === Role.ADMIN) return
		if (user.role !== Role.CATALOG) {
			throw new ForbiddenException(
				'Управлять корзинами могут только менеджеры каталога'
			)
		}

		const catalog = await this.prisma.catalog.findFirst({
			where: { id: catalogId, deleteAt: null },
			select: { id: true, userId: true }
		})

		if (!catalog) {
			throw new NotFoundException('Каталог не найден')
		}

		if (!catalog.userId || catalog.userId !== user.id) {
			throw new ForbiddenException('У вас нет доступа к этой корзине')
		}
	}
}
