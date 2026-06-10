import {
	CartCheckoutMethod,
	CartStatus,
	CartTableSessionStatus,
	OrderStatus,
	ProductVariantStatus
} from '@generated/client'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'

export class CartProductShortDto {
	@ApiProperty({ type: String, format: 'uuid' })
	id: string

	@ApiProperty({ type: String, example: 'Футболка базовая' })
	name: string

	@ApiProperty({ type: String, example: 'futbolka-bazovaya' })
	slug: string

	@ApiProperty({ type: Number, example: 1999, nullable: true })
	price: number | null
}

export class CartVariantAttributeRefDto {
	@ApiProperty({ type: String, format: 'uuid' })
	id: string

	@ApiProperty({ type: String, example: 'size' })
	key: string

	@ApiProperty({ type: String, example: 'Размер' })
	displayName: string
}

export class CartVariantEnumValueDto {
	@ApiProperty({ type: String, format: 'uuid' })
	id: string

	@ApiProperty({ type: String, example: 'xl' })
	value: string

	@ApiProperty({ type: String, nullable: true, example: 'XL' })
	displayName: string | null
}

export class CartVariantAttributeDto {
	@ApiProperty({ type: CartVariantAttributeRefDto })
	attribute: CartVariantAttributeRefDto

	@ApiProperty({ type: CartVariantEnumValueDto })
	enumValue: CartVariantEnumValueDto
}

export class CartVariantDto {
	@ApiProperty({ type: String, format: 'uuid' })
	id: string

	@ApiProperty({ type: String, example: 'NIKE-DRI-XL-WHT' })
	sku: string

	@ApiProperty({ type: String, example: 'size=xl;color=white' })
	variantKey: string

	@ApiProperty({ type: String, example: 'Size: XL, Color: white' })
	label: string

	@ApiProperty({ type: Number, example: 2199, nullable: true })
	price: number | null

	@ApiProperty({ type: Number, example: 4, nullable: true })
	stock: number | null

	@ApiProperty({ enum: ProductVariantStatus, enumName: 'ProductVariantStatus' })
	status: ProductVariantStatus

	@ApiProperty({ type: Boolean })
	isAvailable: boolean

	@ApiProperty({ type: [CartVariantAttributeDto] })
	attributes: CartVariantAttributeDto[]
}

export class CartSaleUnitDto {
	@ApiProperty({ type: String, format: 'uuid' })
	id: string

	@ApiProperty({ type: String, format: 'uuid' })
	variantId: string

	@ApiProperty({ type: String, format: 'uuid', nullable: true })
	catalogSaleUnitId: string | null

	@ApiProperty({ type: String, example: 'pcs' })
	code: string

	@ApiProperty({ type: String, example: 'шт' })
	name: string

	@ApiProperty({ type: Number, example: 1 })
	baseQuantity: number

	@ApiProperty({ type: Number, example: 1999 })
	price: number

	@ApiProperty({ type: String, nullable: true, example: '4601234567890' })
	barcode: string | null

	@ApiProperty({ type: Boolean })
	isDefault: boolean

	@ApiProperty({ type: Boolean })
	isActive: boolean

	@ApiProperty({ type: Number, example: 0 })
	displayOrder: number
}

export class CartItemModifierDto {
	@ApiProperty({ type: String, format: 'uuid' })
	id: string

	@ApiProperty({ type: String, format: 'uuid', nullable: true })
	productModifierGroupId: string | null

	@ApiProperty({ type: String, format: 'uuid', nullable: true })
	productModifierOptionId: string | null

	@ApiProperty({ type: String, format: 'uuid', nullable: true })
	catalogModifierGroupId: string | null

	@ApiProperty({ type: String, format: 'uuid', nullable: true })
	catalogModifierOptionId: string | null

	@ApiProperty({ type: String })
	groupCode: string

	@ApiProperty({ type: String })
	groupName: string

	@ApiProperty({ type: String })
	optionCode: string

	@ApiProperty({ type: String })
	optionName: string

	@ApiProperty({ type: Number, example: 1 })
	quantity: number

	@ApiProperty({ type: Number, example: 100 })
	unitPrice: number
}

export class CartItemDto {
	@ApiProperty({ type: String, format: 'uuid' })
	id: string

	@ApiProperty({ type: String, format: 'uuid' })
	productId: string

	@ApiProperty({ type: String, format: 'uuid', nullable: true })
	variantId: string | null

	@ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
	saleUnitId: string | null

	@ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
	priceListId: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	priceListCode: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	priceListName: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	guestSessionId: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	guestName: string | null

	@ApiProperty({ type: Number, example: 2 })
	quantity: number

	@ApiProperty({ type: Number, example: 12 })
	baseQuantity: number

	@ApiPropertyOptional({
		type: Number,
		nullable: true,
		example: 1999,
		description: 'Снимок цены единицы на момент добавления в корзину'
	})
	unitPriceSnapshot: number | null

	@ApiProperty({ type: CartProductShortDto })
	product: CartProductShortDto

	@ApiProperty({ type: CartVariantDto, nullable: true })
	variant: CartVariantDto | null

	@ApiProperty({ type: CartSaleUnitDto, nullable: true })
	saleUnit: CartSaleUnitDto | null

	@ApiProperty({ type: [CartItemModifierDto] })
	modifiers: CartItemModifierDto[]

	@ApiProperty({ type: Number, example: 1999 })
	unitPrice: number

	@ApiProperty({
		type: Number,
		example: 2499,
		description: 'Базовая цена единицы до применения скидки'
	})
	baseUnitPrice: number

	@ApiProperty({
		type: Number,
		example: 10,
		description: 'Процент скидки, примененный к строке'
	})
	discountPercent: number

	@ApiProperty({
		type: Boolean,
		description: 'Признак активной скидки в сохраненном снимке цены'
	})
	hasDiscount: boolean

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

	@ApiProperty({
		type: Number,
		example: 5997,
		description: 'Сумма без скидок'
	})
	baseSubtotal: number

	@ApiProperty({
		type: Number,
		example: 1000,
		description: 'Суммарная экономия по корзине'
	})
	discountTotal: number

	@ApiProperty({
		type: Boolean,
		description: 'Есть ли скидка хотя бы в одной строке'
	})
	hasDiscount: boolean

	@ApiProperty({
		type: Number,
		example: 4997,
		description: 'Итого к оплате (subtotal с учётом скидок)'
	})
	total: number
}

export class CartTableSessionDto {
	@ApiProperty({ type: String, format: 'uuid' })
	id: string

	@ApiProperty({
		enum: CartTableSessionStatus,
		enumName: 'CartTableSessionStatus'
	})
	status: CartTableSessionStatus

	@ApiProperty({ type: String })
	publicCode: string

	@ApiProperty({ type: String })
	tableExternalId: string

	@ApiProperty({ type: String, nullable: true })
	tableNumber: string | null

	@ApiProperty({ type: String, nullable: true })
	tableName: string | null

	@ApiProperty({ type: String, nullable: true })
	sectionExternalId: string | null

	@ApiProperty({ type: String, nullable: true })
	sectionName: string | null

	@ApiProperty({ type: Number, nullable: true })
	guestsCount: number | null

	@ApiProperty({ type: String, nullable: true })
	externalOrderId: string | null

	@ApiProperty({ type: String, format: 'uuid', nullable: true })
	submittedOrderId: string | null

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	submittedAt: string | null

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	closedAt: string | null

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: string

	@ApiProperty({ type: String, format: 'date-time' })
	updatedAt: string
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

	@ApiProperty({ enum: CartCheckoutMethod, nullable: true })
	checkoutMethod: CartCheckoutMethod | null

	@ApiProperty({ type: Object, nullable: true })
	checkoutData: Record<string, unknown> | null

	@ApiProperty({ type: Object, nullable: true })
	checkoutContacts: Record<string, string> | null

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

	@ApiProperty({ type: CartTableSessionDto, nullable: true })
	tableSession: CartTableSessionDto | null

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

export class CompletedOrderItemDto {
	@ApiProperty({ type: String, format: 'uuid' })
	id: string

	@ApiProperty({ type: String, format: 'uuid' })
	productId: string

	@ApiProperty({ type: String, format: 'uuid', nullable: true })
	variantId: string | null

	@ApiProperty({ type: String, format: 'uuid', nullable: true })
	saleUnitId: string | null

	@ApiProperty({ type: String, format: 'uuid', nullable: true })
	priceListId: string | null

	@ApiProperty({ type: String, nullable: true })
	priceListCode: string | null

	@ApiProperty({ type: String, nullable: true })
	priceListName: string | null

	@ApiProperty({ type: String, nullable: true })
	guestSessionId: string | null

	@ApiProperty({ type: String, nullable: true })
	guestName: string | null

	@ApiProperty({ type: Number, example: 2 })
	quantity: number

	@ApiProperty({ type: Number, example: 12 })
	baseQuantity: number

	@ApiProperty({ type: Number, example: 1999 })
	unitPrice: number

	@ApiProperty({ type: Number, example: 2499 })
	baseUnitPrice: number

	@ApiProperty({ type: Number, example: 10 })
	discountPercent: number

	@ApiProperty({ type: Boolean })
	hasDiscount: boolean

	@ApiProperty({ type: CartVariantDto, nullable: true })
	variant: CartVariantDto | null

	@ApiProperty({ type: CartSaleUnitDto, nullable: true })
	saleUnit: CartSaleUnitDto | null
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

	@ApiProperty({ enum: CartCheckoutMethod, nullable: true })
	checkoutMethod: CartCheckoutMethod | null

	@ApiProperty({ type: Object, nullable: true })
	checkoutData: Record<string, unknown> | null

	@ApiProperty({ type: Object, nullable: true })
	checkoutContacts: Record<string, string> | null

	@ApiProperty({ type: [CompletedOrderItemDto] })
	items: CompletedOrderItemDto[]

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: string
}

export class CompleteCartOrderResponseDto extends OkResponseDto {
	@ApiProperty({ type: CompletedOrderDto })
	order: CompletedOrderDto
}

export class HallTableSessionDto {
	@ApiProperty({ type: CartTableSessionDto })
	session: CartTableSessionDto

	@ApiProperty({ type: CartDto })
	cart: CartDto

	@ApiProperty({
		type: String,
		example: '5f7ec4ac9cc6c392419eec11850d45f1'
	})
	publicKey: string

	@ApiProperty({ type: String, nullable: true })
	guestSessionId: string | null

	@ApiProperty({
		type: String,
		description: 'Private token required to mutate this guest lines'
	})
	guestToken: string
}

export class HallTableSessionResponseDto extends OkResponseDto {
	@ApiProperty({ type: HallTableSessionDto })
	tableSession: HallTableSessionDto
}

export class HallTableLinkDto {
	@ApiProperty({ type: String })
	code: string

	@ApiProperty({ type: String, nullable: true })
	tableName: string | null

	@ApiProperty({ type: String, nullable: true })
	tableNumber: string | null

	@ApiProperty({ type: String, nullable: true })
	sectionId: string | null

	@ApiProperty({ type: String, nullable: true })
	sectionName: string | null
}

export class HallTableLinkResponseDto extends OkResponseDto {
	@ApiProperty({ type: HallTableLinkDto })
	table: HallTableLinkDto
}

export class HallTableOverviewDto extends HallTableLinkDto {
	@ApiProperty({ type: String })
	tableExternalId: string

	@ApiProperty({
		type: String,
		nullable: true,
		example: '5f7ec4ac9cc6c392419eec11850d45f1'
	})
	publicKey: string | null

	@ApiProperty({ type: CartTableSessionDto, nullable: true })
	session: CartTableSessionDto | null

	@ApiProperty({ type: CartDto, nullable: true })
	cart: CartDto | null

	@ApiProperty({ type: Boolean })
	hasItems: boolean

	@ApiProperty({ type: Boolean })
	needsConfirmation: boolean

	@ApiProperty({ type: Number })
	itemsCount: number

	@ApiProperty({ type: Number })
	total: number

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	updatedAt: string | null
}

export class HallTableOverviewResponseDto extends OkResponseDto {
	@ApiProperty({ type: [HallTableOverviewDto] })
	tables: HallTableOverviewDto[]
}
