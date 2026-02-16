import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

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

	@ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
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
}

export class CartDto {
	@ApiProperty({ type: String, format: 'uuid' })
	id: string

	@ApiProperty({ type: String, format: 'uuid' })
	catalogId: string

	@ApiPropertyOptional({
		type: String,
		nullable: true,
		example: '5f7ec4ac9cc6c392419eec11850d45f1'
	})
	publicKey: string | null

	@ApiPropertyOptional({
		type: String,
		format: 'date-time',
		nullable: true
	})
	checkoutAt: string | null

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
