import type { mapCartEntity, UpsertCartItemInput } from './cart.utils'

export const CART_COMMAND_PORT = Symbol('CART_COMMAND_PORT')
export const ORDER_READER_PORT = Symbol('ORDER_READER_PORT')

export type OrderCompletedEvent = {
	type: 'order.completed'
	catalogId: string
	orderId: string
	cartId: string
	occurredAt: Date
}

export type CartCurrentMutationResult = {
	cart: ReturnType<typeof mapCartEntity>
	token: string | null
}

export interface CartCommandPort {
	upsertCurrentItem(
		catalogId: string,
		token: string | null | undefined,
		input: UpsertCartItemInput
	): Promise<CartCurrentMutationResult>

	removeCurrentItem(
		catalogId: string,
		token: string | null | undefined,
		itemId: string
	): Promise<CartCurrentMutationResult>
}

export interface OrderReaderPort {
	getCompletedOrder?(orderId: string): Promise<unknown>
}
