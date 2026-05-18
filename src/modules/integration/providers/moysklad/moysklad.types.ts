export type MoySkladMeta = {
	href: string
	type: string
	mediaType: string
	size?: number
	limit?: number
	offset?: number
	downloadHref?: string
}

export type MoySkladMetaRef = {
	meta: {
		href: string
		type: string
		mediaType?: string
		metadataHref?: string
	}
}

export type MoySkladImage = {
	meta: MoySkladMeta
	title?: string
	filename?: string
	size?: number
	updated?: string
	miniature?: {
		href: string
		type: string
		mediaType: string
		downloadHref: string
	}
	tiny?: {
		href: string
		type: string
		mediaType: string
		downloadHref: string
	}
}

export type MoySkladSalePrice = {
	value: number
	currency?: { meta: MoySkladMeta }
	priceType?: {
		meta: MoySkladMeta
		id: string
		name: string
	}
}

export type MoySkladProductFolderRef = {
	meta: MoySkladMeta
	id?: string
	name?: string
}

export type MoySkladProductFolder = MoySkladProductFolderRef & {
	path?: string[]
	namepath?: string
	productFolder?: MoySkladProductFolderRef
}

export type MoySkladNamedEntity = {
	meta?: MoySkladMeta
	id: string
	name: string
	code?: string
	externalCode?: string
	archived?: boolean
	updated?: string
}

export type MoySkladOrganization = MoySkladNamedEntity

export type MoySkladCounterparty = MoySkladNamedEntity

export type MoySkladStore = MoySkladNamedEntity

export type MoySkladProductRef = {
	meta: MoySkladMeta
	id?: string
	name?: string
}

export type MoySkladVariantCharacteristic = {
	id?: string
	meta?: MoySkladMeta
	name: string
	value: string
}

export type MoySkladBarcode = {
	ean13?: string
	ean8?: string
	code128?: string
	gtin?: string
}

export type MoySkladEntityType = 'product' | 'service' | 'bundle' | 'variant'

export type MoySkladProduct = {
	meta?: MoySkladMeta
	id: string
	name: string
	description?: string
	code?: string
	externalCode?: string
	article?: string
	archived: boolean
	updated: string
	stock?: number
	barcodes?: MoySkladBarcode[]
	salePrices?: MoySkladSalePrice[]
	images?: {
		meta: MoySkladMeta
		rows?: MoySkladImage[]
	}
	productFolder?: MoySkladProductFolderRef
	product?: MoySkladProductRef
	characteristics?: MoySkladVariantCharacteristic[]
}

export type MoySkladVariant = MoySkladProduct & {
	product: MoySkladProductRef
	characteristics: MoySkladVariantCharacteristic[]
}

export type MoySkladWebhookEntityType = MoySkladEntityType | 'productfolder'

export type MoySkladListResponse<T> = {
	context?: { employee?: { meta: MoySkladMeta } }
	meta: MoySkladMeta
	rows: T[]
}

export type MoySkladStockItem = {
	meta: {
		href: string
		type: string
	}
	stock?: number
	reserve?: number
	quantity?: number
	name?: string
	code?: string
	article?: string
}

export type MoySkladStockResponse = {
	context?: { employee?: { meta: MoySkladMeta } }
	meta: MoySkladMeta
	rows: MoySkladStockItem[]
}

export type MoySkladStockReportFilters = {
	assortmentId?: string | string[]
	storeId?: string | string[]
	warehouseId?: string | string[]
}

export type MoySkladStockWebhookReportType = 'all'

export type MoySkladStockWebhookStockType = 'stock'

export type MoySkladProductDeleteWebhookEntityType =
	| 'product'
	| 'service'
	| 'bundle'
	| 'variant'

export type MoySkladProductChangeWebhookEntityType = MoySkladEntityType

export type MoySkladProductChangeWebhookAction = 'CREATE' | 'UPDATE'

export type MoySkladProductFolderWebhookAction = 'CREATE' | 'UPDATE' | 'DELETE'

export type MoySkladStockWebhookMetadata = {
	externalId: string | null
	accountId: string | null
	secretHash: string | null
	reportType: MoySkladStockWebhookReportType
	stockType: MoySkladStockWebhookStockType
	lastReceivedAt: string | null
	lastProcessedAt: string | null
	lastError: string | null
}

export type MoySkladProductDeleteWebhookMetadata = {
	enabled: boolean
	externalIds: Record<MoySkladProductDeleteWebhookEntityType, string | null>
	accountId: string | null
	secretHash: string | null
	lastReceivedAt: string | null
	lastProcessedAt: string | null
	lastError: string | null
}

export type MoySkladProductChangeWebhookMetadata = {
	enabled: boolean
	externalIds: Record<
		MoySkladProductChangeWebhookEntityType,
		Record<MoySkladProductChangeWebhookAction, string | null>
	>
	accountId: string | null
	secretHash: string | null
	lastReceivedAt: string | null
	lastProcessedAt: string | null
	lastError: string | null
}

export type MoySkladProductFolderWebhookMetadata = {
	enabled: boolean
	externalIds: Record<MoySkladProductFolderWebhookAction, string | null>
	accountId: string | null
	secretHash: string | null
	lastReceivedAt: string | null
	lastProcessedAt: string | null
	lastError: string | null
}

export type MoySkladFieldOwnershipValue = 'external' | 'local'

export type MoySkladFieldOwnership = {
	price: MoySkladFieldOwnershipValue
	stock: MoySkladFieldOwnershipValue
	content: MoySkladFieldOwnershipValue
	images: MoySkladFieldOwnershipValue
}

export type MoySkladWebhookStock = {
	meta?: MoySkladMeta
	id: string
	accountId?: string
	enabled: boolean
	stockType: MoySkladStockWebhookStockType
	reportType: MoySkladStockWebhookReportType
	url: string
}

export type MoySkladWebhookStockPayload = {
	url?: string
	enabled?: boolean
	stockType?: MoySkladStockWebhookStockType
	reportType?: MoySkladStockWebhookReportType
}

export type MoySkladWebhookAction = 'CREATE' | 'UPDATE' | 'DELETE'

export type MoySkladWebhook = {
	meta?: MoySkladMeta
	id: string
	accountId?: string
	enabled: boolean
	action: MoySkladWebhookAction
	entityType: MoySkladWebhookEntityType
	url: string
}

export type MoySkladWebhookPayload = {
	url?: string
	enabled?: boolean
	action?: MoySkladWebhookAction
	entityType?: MoySkladWebhookEntityType
}

export type MoySkladStockWebhookNotification = {
	accountId: string
	stockType: MoySkladStockWebhookStockType
	reportType: MoySkladStockWebhookReportType
	reportUrl: string
}

export type MoySkladProductDeleteWebhookNotification = {
	accountId: string
	action: 'DELETE'
	entityType: MoySkladProductDeleteWebhookEntityType
	externalId: string
	href: string
}

export type MoySkladProductChangeWebhookNotification = {
	accountId: string
	action: MoySkladProductChangeWebhookAction
	entityType: MoySkladProductChangeWebhookEntityType
	externalId: string
	href: string
}

export type MoySkladProductFolderWebhookNotification = {
	accountId: string
	action: MoySkladProductFolderWebhookAction
	entityType: 'productfolder'
	externalId: string
	href: string
}

export type MoySkladCustomerOrderPosition = {
	quantity: number
	price: number
	discount?: number
	vat?: number
	assortment: MoySkladMetaRef
}

export type MoySkladCreateCustomerOrderPayload = {
	externalCode: string
	moment?: string
	description?: string
	organization: MoySkladMetaRef
	agent: MoySkladMetaRef
	store?: MoySkladMetaRef
	positions: MoySkladCustomerOrderPosition[]
}

export type MoySkladCustomerOrder = {
	meta?: MoySkladMeta
	id: string
	name?: string
	externalCode?: string
	moment?: string
	created?: string
	updated?: string
}

export type MoySkladMetadata = {
	token: string
	priceTypeName: string
	importImages: boolean
	syncStock: boolean
	exportOrders: boolean
	orderExportOrganizationId: string | null
	orderExportCounterpartyId: string | null
	orderExportStoreId: string | null
	scheduleEnabled: boolean
	schedulePattern: string | null
	scheduleTimezone: string
	lastStockSyncedAt: string | null
	stockWebhookEnabled: boolean
	stockWebhook: MoySkladStockWebhookMetadata
	productDeleteWebhook: MoySkladProductDeleteWebhookMetadata
	productChangeWebhook: MoySkladProductChangeWebhookMetadata
	productFolderWebhook: MoySkladProductFolderWebhookMetadata
	fieldOwnership: MoySkladFieldOwnership
}

export type EncryptedMoySkladToken = {
	format: 'enc-v1'
	alg: 'aes-256-gcm'
	keyVersion: string
	iv: string
	tag: string
	ciphertext: string
}

export type StoredMoySkladMetadata = Omit<MoySkladMetadata, 'token'> & {
	token?: string
	tokenEncrypted?: EncryptedMoySkladToken
}
