export type MoySkladMeta = {
	href: string
	type: string
	mediaType: string
	size?: number
	limit?: number
	offset?: number
	downloadHref?: string
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
	salePrices?: MoySkladSalePrice[]
	images?: {
		meta: MoySkladMeta
		rows?: MoySkladImage[]
	}
	productFolder?: MoySkladProductFolderRef
}

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

export type MoySkladMetadata = {
	token: string
	priceTypeName: string
	importImages: boolean
	syncStock: boolean
	scheduleEnabled: boolean
	schedulePattern: string | null
	scheduleTimezone: string
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
