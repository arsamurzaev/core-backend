import type { Prisma } from '@generated/client'
import { OrderStatus } from '@generated/enums'
import { Inject, Injectable } from '@nestjs/common'

import {
	CAPABILITY_ASSERT_PORT,
	type CapabilityAssertPort
} from '@/modules/capability/contracts'
import {
	normalizeOrderProducts,
	type OrderExternalLinkSnapshot
} from '@/shared/order/order-products.utils'

import {
	type IntegrationOrderExportRecord,
	type IntegrationProductLinkRecord,
	IntegrationRepository,
	type IntegrationVariantLinkRecord,
	type OrderForExportRecord
} from '../../integration.repository'

import { buildMoySkladMetaRef, MoySkladClient } from './moysklad.client'
import { MoySkladMetadataCryptoService } from './moysklad.metadata'
import type {
	MoySkladCreateCustomerOrderPayload,
	MoySkladCustomerOrder,
	MoySkladEntityType,
	MoySkladMetaRef
} from './moysklad.types'

const EXPORTED_ORDER_EXTERNAL_CODE_PREFIX = 'ctlg-order'
const MOYSKLAD_DATETIME_PRECISION_MS = 3
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SUPPORTED_ASSORTMENT_TYPES = new Set<MoySkladEntityType>([
	'product',
	'service',
	'bundle',
	'variant'
])

type ExportMoySkladOrderResult = {
	externalId: string
	created: boolean
	response: MoySkladCustomerOrder
}

type AssortmentRef = {
	id: string
	type: MoySkladEntityType
}

export class NonRetryableMoySkladOrderExportError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'NonRetryableMoySkladOrderExportError'
	}
}

@Injectable()
export class MoySkladOrderExportService {
	constructor(
		private readonly repo: IntegrationRepository,
		private readonly metadataCrypto: MoySkladMetadataCryptoService,
		@Inject(CAPABILITY_ASSERT_PORT)
		private readonly featureEntitlements: CapabilityAssertPort
	) {}

	async exportOrder(
		exportRecord: IntegrationOrderExportRecord
	): Promise<ExportMoySkladOrderResult> {
		const order = await this.repo.findOrderForExport(exportRecord.orderId)
		if (!order) {
			throw new NonRetryableMoySkladOrderExportError(
				`Order ${exportRecord.orderId} was not found`
			)
		}
		await this.featureEntitlements.assertCanUseMoySkladIntegration(
			order.catalogId
		)

		const integration = await this.repo.findMoySklad(order.catalogId)
		if (!integration || integration.id !== exportRecord.integrationId) {
			throw new NonRetryableMoySkladOrderExportError(
				`MoySklad integration ${exportRecord.integrationId} is not active for order ${order.id}`
			)
		}
		if (!integration.isActive) {
			throw new NonRetryableMoySkladOrderExportError(
				`MoySklad integration ${integration.id} is disabled`
			)
		}

		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)
		if (!metadata.exportOrders) {
			throw new NonRetryableMoySkladOrderExportError(
				`MoySklad order export is disabled for integration ${integration.id}`
			)
		}

		const payload = await this.buildPayload(order, integration.id, {
			organizationId: metadata.orderExportOrganizationId,
			counterpartyId: metadata.orderExportCounterpartyId,
			storeId: metadata.orderExportStoreId
		})

		await this.repo.setOrderExportPayload(
			exportRecord.id,
			payload as unknown as Prisma.InputJsonValue
		)

		const client = new MoySkladClient({ token: metadata.token })
		const existing = await client.findCustomerOrderByExternalCode(
			payload.externalCode
		)
		if (existing) {
			return {
				externalId: existing.id,
				created: false,
				response: existing
			}
		}

		const created = await client.createCustomerOrder(payload)
		return {
			externalId: created.id,
			created: true,
			response: created
		}
	}

	private async buildPayload(
		order: OrderForExportRecord,
		integrationId: string,
		refs: {
			organizationId: string | null
			counterpartyId: string | null
			storeId: string | null
		}
	): Promise<MoySkladCreateCustomerOrderPayload> {
		if (order.status !== OrderStatus.COMPLETED) {
			throw new NonRetryableMoySkladOrderExportError(
				`Only completed orders can be exported, got ${order.status}`
			)
		}
		if (!refs.organizationId || !refs.counterpartyId || !refs.storeId) {
			throw new NonRetryableMoySkladOrderExportError(
				'MoySklad order export refs are not fully configured'
			)
		}

		const items = normalizeOrderProducts(order.products)
		if (!items.length) {
			throw new NonRetryableMoySkladOrderExportError(
				`Order ${order.id} has no product lines`
			)
		}

		const positions = []
		for (const item of items) {
			const assortment = await this.resolveAssortmentRef(integrationId, item)
			const quantity = item.baseQuantity > 0 ? item.baseQuantity : item.quantity
			const unitPrice =
				quantity > 0 && item.lineTotal > 0
					? item.lineTotal / quantity
					: item.unitPrice
			positions.push({
				quantity,
				price: Math.round(unitPrice * 100),
				discount: 0,
				assortment
			})
		}

		return {
			externalCode: this.buildExternalCode(order.id),
			moment: formatMoySkladDateTime(order.createdAt),
			description: buildOrderDescription(order),
			organization: buildMoySkladMetaRef('organization', refs.organizationId),
			agent: buildMoySkladMetaRef('counterparty', refs.counterpartyId),
			store: buildMoySkladMetaRef('store', refs.storeId),
			positions
		}
	}

	private async resolveAssortmentRef(
		integrationId: string,
		item: {
			productId: string | null
			variantId: string | null
			externalProducts: OrderExternalLinkSnapshot[]
			externalVariants: OrderExternalLinkSnapshot[]
		}
	): Promise<MoySkladMetaRef> {
		if (item.variantId) {
			const snapshotRef = this.resolveSnapshotLinkRef(
				integrationId,
				item.externalVariants,
				'variant'
			)
			if (snapshotRef) {
				return buildMoySkladMetaRef(snapshotRef.type, snapshotRef.id)
			}

			const variantLink = await this.repo.findVariantLinkByVariantId(
				integrationId,
				item.variantId
			)
			const ref = variantLink ? this.resolveLinkRef(variantLink, 'variant') : null
			if (ref) {
				return buildMoySkladMetaRef(ref.type, ref.id)
			}
		}

		if (item.productId) {
			const snapshotRef = this.resolveSnapshotLinkRef(
				integrationId,
				item.externalProducts,
				'product'
			)
			if (snapshotRef) {
				return buildMoySkladMetaRef(snapshotRef.type, snapshotRef.id)
			}

			const productLink = await this.repo.findProductLinkByProductId(
				integrationId,
				item.productId
			)
			const ref = productLink ? this.resolveLinkRef(productLink, 'product') : null
			if (ref) {
				return buildMoySkladMetaRef(ref.type, ref.id)
			}
		}

		throw new NonRetryableMoySkladOrderExportError(
			`No MoySklad assortment mapping for product=${item.productId ?? 'null'}, variant=${item.variantId ?? 'null'}`
		)
	}

	private resolveSnapshotLinkRef(
		integrationId: string,
		links: OrderExternalLinkSnapshot[],
		fallbackType: MoySkladEntityType
	): AssortmentRef | null {
		for (const link of links) {
			if (link.integrationId !== integrationId) continue

			const rawId = readString(link.assortmentRef?.id)
			const rawType = readString(link.assortmentRef?.type)
			if (rawId && isSupportedAssortmentType(rawType)) {
				return { id: rawId, type: rawType }
			}

			const externalId = readString(link.externalId)
			if (externalId && UUID_PATTERN.test(externalId)) {
				return { id: externalId, type: fallbackType }
			}
		}

		return null
	}

	private resolveLinkRef(
		link: IntegrationProductLinkRecord | IntegrationVariantLinkRecord,
		fallbackType: MoySkladEntityType
	): AssortmentRef | null {
		const rawMeta = isRecord(link.rawMeta) ? link.rawMeta : null
		const rawId = readString(rawMeta?.id)
		const rawType = readString(rawMeta?.type)
		if (rawId && isSupportedAssortmentType(rawType)) {
			return { id: rawId, type: rawType }
		}

		if (UUID_PATTERN.test(link.externalId)) {
			return { id: link.externalId, type: fallbackType }
		}

		return null
	}

	private buildExternalCode(orderId: string): string {
		return `${EXPORTED_ORDER_EXTERNAL_CODE_PREFIX}-${orderId}`
	}
}

function buildOrderDescription(order: OrderForExportRecord): string {
	const parts = [`Catalog order ${order.id}`]
	const comment = normalizeText(order.comment)
	const address = normalizeText(order.address)
	if (comment) parts.push(`Comment: ${comment}`)
	if (address) parts.push(`Address: ${address}`)
	return parts.join('\n').slice(0, 2000)
}

function formatMoySkladDateTime(value: Date): string {
	const pad = (item: number, size = 2) => String(item).padStart(size, '0')
	return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}.${pad(value.getMilliseconds(), MOYSKLAD_DATETIME_PRECISION_MS)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized || null
}

function normalizeText(value: unknown): string | null {
	const normalized = readString(value)
	return normalized?.replace(/\s+/g, ' ') ?? null
}

function isSupportedAssortmentType(
	value: string | null
): value is MoySkladEntityType {
	return Boolean(
		value && SUPPORTED_ASSORTMENT_TYPES.has(value as MoySkladEntityType)
	)
}
