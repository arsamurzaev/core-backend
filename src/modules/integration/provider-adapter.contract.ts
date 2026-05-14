import { IntegrationProvider } from '@generated/enums'

export type IntegrationProviderRawMeta = Record<string, unknown> | null

export type IntegrationProviderConnectionResult = {
	ok: true
	provider: IntegrationProvider
	accountName?: string | null
	rawMeta?: IntegrationProviderRawMeta
}

export type IntegrationProviderProduct = {
	externalId: string
	externalCode?: string | null
	name: string
	description?: string | null
	categoryExternalId?: string | null
	priceCents?: number | null
	sku?: string | null
	barcode?: string | null
	imageUrls?: string[]
	archived?: boolean
	externalUpdatedAt?: Date | null
	rawMeta?: IntegrationProviderRawMeta
}

export type IntegrationProviderVariantAttribute = {
	externalId?: string | null
	name: string
	value: string
	rawMeta?: IntegrationProviderRawMeta
}

export type IntegrationProviderVariant = {
	externalId: string
	externalProductId: string
	externalCode?: string | null
	name?: string | null
	sku?: string | null
	barcodes?: string[]
	priceCents?: number | null
	stock?: number | null
	attributes: IntegrationProviderVariantAttribute[]
	archived?: boolean
	externalUpdatedAt?: Date | null
	rawMeta?: IntegrationProviderRawMeta
}

export type IntegrationProviderStockRow = {
	externalAssortmentId: string
	externalProductId?: string | null
	externalVariantId?: string | null
	externalWarehouseId?: string | null
	quantity: number
	reserved?: number | null
	available?: number | null
	externalUpdatedAt?: Date | null
	rawMeta?: IntegrationProviderRawMeta
}

export type IntegrationProviderOrderLine = {
	productId: string
	variantId: string
	externalProductId?: string | null
	externalVariantId?: string | null
	name: string
	sku?: string | null
	quantity: number
	unitPriceCents: number
	lineTotalCents: number
	rawMeta?: IntegrationProviderRawMeta
}

export type IntegrationProviderOrderPayload = {
	orderId: string
	idempotencyKey: string
	catalogId: string
	customerName?: string | null
	customerPhone?: string | null
	customerEmail?: string | null
	comment?: string | null
	totalCents: number
	lines: IntegrationProviderOrderLine[]
	rawMeta?: IntegrationProviderRawMeta
}

export type IntegrationProviderOrderResult = {
	externalId: string
	externalCode?: string | null
	status?: string | null
	rawMeta?: IntegrationProviderRawMeta
}

export type IntegrationProviderStockReservation = {
	reservationId: string
	variantId: string
	externalVariantId?: string | null
	quantity: number
	expiresAt?: Date | null
	rawMeta?: IntegrationProviderRawMeta
}

export interface IntegrationProviderAdapter {
	readonly provider: IntegrationProvider

	testConnection(): Promise<IntegrationProviderConnectionResult>

	pullProducts(): AsyncIterable<IntegrationProviderProduct>

	pullVariants(): AsyncIterable<IntegrationProviderVariant>

	pullStock(): AsyncIterable<IntegrationProviderStockRow>

	pullPrices?(): AsyncIterable<IntegrationProviderVariant>

	pushOrder?(
		payload: IntegrationProviderOrderPayload
	): Promise<IntegrationProviderOrderResult>

	reserveStock?(
		reservation: IntegrationProviderStockReservation
	): Promise<IntegrationProviderStockReservation>

	releaseReservation?(reservationId: string): Promise<void>
}
