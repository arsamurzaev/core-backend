import type { Prisma } from '@generated/client'

import { buildMediaSelect } from '@/shared/media/media-select'
import { MEDIA_VARIANT_NAMES } from '@/shared/media/media-url.service'

export const cartSelect = {
	id: true,
	catalogId: true,
	token: true,
	status: true,
	statusChangedAt: true,
	publicKey: true,
	checkoutKey: true,
	checkoutAt: true,
	checkoutMethod: true,
	checkoutData: true,
	checkoutContacts: true,
	comment: true,
	assignedManagerId: true,
	managerSessionStartedAt: true,
	managerLastSeenAt: true,
	closedAt: true,
	tableSession: {
		select: {
			id: true,
			cartId: true,
			status: true,
			publicCode: true,
			tableExternalId: true,
			tableNumber: true,
			tableName: true,
			sectionExternalId: true,
			sectionName: true,
			guestsCount: true,
			externalOrderId: true,
			submittedOrderId: true,
			submittedAt: true,
			closedAt: true,
			createdAt: true,
			updatedAt: true
		}
	},
	createdAt: true,
	updatedAt: true,
	catalog: {
		select: {
			parentId: true,
			settings: { select: { inventoryMode: true } }
		}
	},
	items: {
		where: { deleteAt: null },
		select: {
			id: true,
			productId: true,
			variantId: true,
			saleUnitId: true,
			modifierSignature: true,
			quantity: true,
			baseQuantity: true,
			unitPriceSnapshot: true,
			priceListId: true,
			priceListCode: true,
			priceListName: true,
			guestSessionId: true,
			guestName: true,
			createdAt: true,
			updatedAt: true,
			product: {
				select: {
					id: true,
					name: true,
					slug: true,
					price: true,
					productAttributes: {
						where: { deleteAt: null },
						select: {
							id: true,
							attributeId: true,
							valueDecimal: true,
							valueInteger: true,
							valueString: true,
							valueDateTime: true,
							attribute: {
								select: {
									key: true
								}
							}
						}
					},
					media: {
						select: {
							position: true,
							media: { select: buildMediaSelect([MEDIA_VARIANT_NAMES.thumb]) }
						},
						orderBy: { position: 'asc' as const },
						take: 1
					}
				}
			},
			variant: {
				select: {
					id: true,
					sku: true,
					variantKey: true,
					price: true,
					stock: true,
					status: true,
					isAvailable: true,
					attributes: {
						where: { deleteAt: null },
						select: {
							attribute: {
								select: {
									id: true,
									key: true,
									displayName: true,
									displayOrder: true
								}
							},
							enumValue: {
								select: {
									id: true,
									value: true,
									displayName: true,
									displayOrder: true
								}
							}
						}
					}
				}
			},
			saleUnit: {
				select: {
					id: true,
					variantId: true,
					catalogSaleUnitId: true,
					code: true,
					name: true,
					baseQuantity: true,
					price: true,
					barcode: true,
					isDefault: true,
					isActive: true,
					displayOrder: true
				}
			},
			modifiers: {
				select: {
					id: true,
					productModifierGroupId: true,
					productModifierOptionId: true,
					catalogModifierGroupId: true,
					catalogModifierOptionId: true,
					groupCode: true,
					groupName: true,
					optionCode: true,
					optionName: true,
					quantity: true,
					unitPriceSnapshot: true
				},
				orderBy: [
					{ groupName: 'asc' as const },
					{ optionName: 'asc' as const },
					{ id: 'asc' as const }
				]
			}
		},
		orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }]
	}
} satisfies Prisma.CartSelect

export type CartEntity = Prisma.CartGetPayload<{ select: typeof cartSelect }>
