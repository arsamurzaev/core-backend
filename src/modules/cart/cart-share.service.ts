import {
	CartCheckoutMethod,
	CartStatus,
	ContactType,
	Prisma
} from '@generated/client'
import { Injectable, NotFoundException } from '@nestjs/common'
import { randomBytes } from 'node:crypto'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import {
	type CatalogCheckoutData,
	normalizeCartCheckoutData,
	resolveCatalogCheckoutConfig,
	resolveCheckoutContactsSnapshot
} from '@/modules/catalog/contracts'

import { CartCurrentService } from './cart-current.service'
import { CartInventoryReservationService } from './cart-inventory-reservation.service'
import { CartLookupService } from './cart-lookup.service'
import type { CartEntity } from './cart.selects'
import { PUBLIC_KEY_BYTES } from './cart.utils'

export type CartShareInput = {
	checkoutData?: unknown
	checkoutMethod?: CartCheckoutMethod
	comment?: string | null
}

export type CartShareResult = {
	cart: CartEntity
	token: string
}

@Injectable()
export class CartShareService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly inventoryReservation: CartInventoryReservationService,
		private readonly currentCart: CartCurrentService,
		private readonly lookup: CartLookupService
	) {}

	async shareCurrentCart(
		catalogId: string,
		token?: string | null,
		input: CartShareInput | string | null = {}
	): Promise<CartShareResult> {
		const shareInput: CartShareInput =
			typeof input === 'string' ? { comment: input } : (input ?? {})
		const current = await this.currentCart.getOrCreate(catalogId, token)
		let publicKey = current.cart.publicKey
		const now = new Date()
		const data: Prisma.CartUpdateInput = {}
		const normalizedComment = this.normalizeCartComment(shareInput.comment)
		const checkout = await this.resolveCheckoutSnapshot(catalogId, shareInput)

		if (!publicKey) {
			publicKey = await this.generateUniquePublicKey()
			data.publicKey = publicKey
		}

		if (current.cart.status === CartStatus.DRAFT) {
			data.status = CartStatus.SHARED
			data.statusChangedAt = now
		}

		if (normalizedComment !== current.cart.comment) {
			data.comment = normalizedComment
		}

		data.checkoutMethod = checkout.checkoutMethod
		data.checkoutData = checkout.checkoutData as Prisma.InputJsonValue
		data.checkoutContacts = checkout.checkoutContacts as Prisma.InputJsonValue

		const result = await this.prisma.$transaction(async tx => {
			if (Object.keys(data).length > 0) {
				await tx.cart.update({
					where: { id: current.cart.id },
					data
				})
			}

			const updated = await this.lookup.findByIdOrThrow(current.cart.id, tx)
			const reserveEffect =
				await this.inventoryReservation.reserveCartStockIfNeededTx(
					tx,
					updated,
					null
				)

			return {
				cart: reserveEffect.reserved
					? await this.lookup.findByIdOrThrow(current.cart.id, tx)
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
			token: current.token
		}
	}

	async resolveCheckoutSnapshot(
		catalogId: string,
		input: CartShareInput
	): Promise<{
		checkoutContacts: Record<string, string>
		checkoutData: CatalogCheckoutData
		checkoutMethod: CartCheckoutMethod | null
	}> {
		const catalog = await this.prisma.catalog.findFirst({
			where: { id: catalogId, deleteAt: null },
			select: {
				type: { select: { code: true } },
				settings: { select: { address: true, checkout: true } },
				contacts: {
					where: { deleteAt: null },
					select: { type: true, value: true },
					orderBy: [{ position: 'asc' as const }, { createdAt: 'asc' as const }]
				}
			}
		})

		if (!catalog) {
			throw new NotFoundException('Каталог не найден')
		}

		const config = resolveCatalogCheckoutConfig({
			checkout: catalog.settings?.checkout,
			typeCode: catalog.type?.code
		})
		const checkout = normalizeCartCheckoutData({
			catalogAddress: catalog.settings?.address,
			config,
			data: input.checkoutData,
			mapUrl: this.resolveCatalogMapUrl(catalog.contacts),
			method: input.checkoutMethod
		})
		const checkoutContacts = resolveCheckoutContactsSnapshot({
			catalogContacts: catalog.contacts,
			config,
			method: checkout.checkoutMethod
		})

		return {
			checkoutContacts: checkoutContacts as Record<string, string>,
			checkoutData: checkout.checkoutData,
			checkoutMethod: checkout.checkoutMethod
		}
	}

	private resolveCatalogMapUrl(
		contacts: Array<{ type: ContactType; value: string }>
	): string | null {
		const contact = contacts.find(item => item.type === ContactType.MAP)
		const value = contact?.value?.trim()
		return value || null
	}

	private normalizeCartComment(comment?: string | null) {
		const normalized = comment?.trim()
		return normalized ? normalized : null
	}

	private async generateUniquePublicKey() {
		for (;;) {
			const candidate = randomBytes(PUBLIC_KEY_BYTES).toString('base64url')
			const exists = await this.prisma.cart.findFirst({
				where: { publicKey: candidate },
				select: { id: true }
			})
			if (!exists) return candidate
		}
	}
}
