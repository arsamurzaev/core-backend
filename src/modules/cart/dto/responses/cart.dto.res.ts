import { CartStatus, OrderStatus } from '@generated/client'
import { ApiProperty } from '@nestjs/swagger'

import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'

export class CartProductShortDto {
	@ApiProperty({ type: String, format: 'uuid' })
	id: string

	@ApiProperty({ type: String, example: 'Футболка базовая' })
	name: string

	@ApiProperty({ type: String, example: 'futbolka-bazovaya' })
	slug: string

	@ApiProperty({ type: Number, example: 1999 })
	price: number
}

export class CartItemDto {
	@ApiProperty({ type: String, format: 'uuid' })
	id: string

	@ApiProperty({ type: String, format: 'uuid' })
	productId: string

	@ApiProperty({ type: String, format: 'uuid', nullable: true })
	variantId: string | null

	@ApiProperty({ type: Number, example: 2 })
	quantity: number

	@ApiProperty({ type: CartProductShortDto })
	product: CartProductShortDto

	@ApiProperty({ type: Number, example: 3998 })
	lineTotal: number

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: string

	@ApiProperty({ type: String, format: 'date-time' })
	updatedAt: string
}

export class CartTotalsDto {
	@ApiProperty({ type: Number, example: 3 })
	itemsCount: number

	@ApiProperty({ type: Number, example: 4997 })
	subtotal: number

	@ApiProperty({ type: Number, example: 4997, description: 'Итого к оплате (subtotal с учётом скидок)' })
	total: number
}

export class CartDto {
	@ApiProperty({ type: String, format: 'uuid' })
	id: string

	@ApiProperty({ type: String, format: 'uuid' })
	catalogId: string

	@ApiProperty({ enum: CartStatus, enumName: 'CartStatus' })
	status: CartStatus

	@ApiProperty({
		type: String,
		nullable: true,
		example: 'Менеджер магазина сейчас просматривает ваш заказ.'
	})
	statusMessage: string | null

	@ApiProperty({ type: String, format: 'date-time' })
	statusChangedAt: string

	@ApiProperty({
		type: String,
		nullable: true,
		example: '5f7ec4ac9cc6c392419eec11850d45f1'
	})
	publicKey: string | null

	@ApiProperty({
		type: String,
		format: 'date-time',
		nullable: true
	})
	checkoutAt: string | null

	@ApiProperty({
		type: String,
		nullable: true,
		example: 'Позвоните перед доставкой'
	})
	comment: string | null

	@ApiProperty({
		type: String,
		format: 'uuid',
		nullable: true
	})
	assignedManagerId: string | null

	@ApiProperty({
		type: String,
		format: 'date-time',
		nullable: true
	})
	managerSessionStartedAt: string | null

	@ApiProperty({
		type: String,
		format: 'date-time',
		nullable: true
	})
	managerLastSeenAt: string | null

	@ApiProperty({
		type: String,
		format: 'date-time',
		nullable: true
	})
	closedAt: string | null

	@ApiProperty({ type: [CartItemDto] })
	items: CartItemDto[]

	@ApiProperty({ type: CartTotalsDto })
	totals: CartTotalsDto

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: string

	@ApiProperty({ type: String, format: 'date-time' })
	updatedAt: string
}

export class CartResponseDto extends OkResponseDto {
	@ApiProperty({ type: CartDto })
	cart: CartDto
}

export class ShareCartResponseDto extends CartResponseDto {
	@ApiProperty({
		type: String,
		example: '5f7ec4ac9cc6c392419eec11850d45f1'
	})
	publicKey: string
}

export class CheckoutCartResponseDto extends CartResponseDto {
	@ApiProperty({
		type: String,
		example: '5f7ec4ac9cc6c392419eec11850d45f1'
	})
	publicKey: string

	@ApiProperty({
		type: String,
		example: '7b5f8d06f87d14d4a4f1f3f9826459fd9f9a'
	})
	checkoutKey: string
}

export class CompletedOrderItemDto {
	@ApiProperty({ type: String, format: 'uuid' })
	id: string

	@ApiProperty({ type: String, format: 'uuid' })
	productId: string

	@ApiProperty({ type: String, format: 'uuid', nullable: true })
	variantId: string | null

	@ApiProperty({ type: Number, example: 2 })
	quantity: number

	@ApiProperty({ type: Number, example: 1999 })
	unitPrice: number
}

export class CompletedOrderDto {
	@ApiProperty({ type: String, format: 'uuid' })
	id: string

	@ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus' })
	status: OrderStatus

	@ApiProperty({ type: String, format: 'uuid' })
	catalogId: string

	@ApiProperty({ type: Number, example: 3998 })
	totalAmount: number

	@ApiProperty({ type: [CompletedOrderItemDto] })
	items: CompletedOrderItemDto[]

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: string
}

export class CompleteCartOrderResponseDto extends OkResponseDto {
	@ApiProperty({ type: CompletedOrderDto })
	order: CompletedOrderDto
}
