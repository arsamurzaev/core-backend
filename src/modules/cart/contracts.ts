export const CART_COMMAND_PORT = Symbol('CART_COMMAND_PORT')
export const ORDER_READER_PORT = Symbol('ORDER_READER_PORT')

export type OrderCompletedEvent = {
	type: 'order.completed'
	catalogId: string
	orderId: string
	cartId: string
	occurredAt: Date
}

export interface CartCommandPort {
	upsertCurrentItem(...args: unknown[]): Promise<unknown>
	removeCurrentItem(...args: unknown[]): Promise<unknown>
}

export interface OrderReaderPort {
	getCompletedOrder?(orderId: string): Promise<unknown>
}
