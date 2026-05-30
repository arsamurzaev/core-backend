export const ONE_C_API_KINDS = ['ODATA', 'HTTP_SERVICE', 'CUSTOM'] as const
export type OneCApiKind = (typeof ONE_C_API_KINDS)[number]

export const ONE_C_AUTH_KINDS = ['BASIC', 'BEARER', 'NONE'] as const
export type OneCAuthKind = (typeof ONE_C_AUTH_KINDS)[number]

export type OneCEncryptedSecret = {
	format: 'enc-v1'
	alg: 'aes-256-gcm'
	keyVersion: string
	iv: string
	tag: string
	ciphertext: string
}

export type OneCMetadata = {
	apiKind: OneCApiKind
	authKind: OneCAuthKind
	baseUrl: string
	username: string | null
	password: string | null
	token: string | null
	timeoutMs: number
	importProducts: boolean
	syncStock: boolean
	exportOrders: boolean
	productSyncEntityMappingId: string | null
	productSyncLimit: number
	productSyncFilter: string | null
	variantSyncEntityMappingId: string | null
	variantSyncLimit: number
	variantSyncFilter: string | null
	stockSyncEntityMappingId: string | null
	stockSyncLimit: number
	stockSyncFilter: string | null
	priceSyncEntityMappingId: string | null
	priceSyncLimit: number
	priceSyncFilter: string | null
	scheduleEnabled: boolean
	schedulePattern: string | null
	scheduleTimezone: string
	stockScheduleEnabled: boolean
	stockSchedulePattern: string | null
	stockScheduleTimezone: string
	priceScheduleEnabled: boolean
	priceSchedulePattern: string | null
	priceScheduleTimezone: string
	lastDiscoveredAt: string | null
}

export type StoredOneCMetadata = {
	apiKind: OneCApiKind
	authKind: OneCAuthKind
	baseUrl: string
	username?: string | null
	passwordEncrypted?: OneCEncryptedSecret
	tokenEncrypted?: OneCEncryptedSecret
	timeoutMs: number
	importProducts: boolean
	syncStock: boolean
	exportOrders: boolean
	productSyncEntityMappingId?: string | null
	productSyncLimit?: number
	productSyncFilter?: string | null
	variantSyncEntityMappingId?: string | null
	variantSyncLimit?: number
	variantSyncFilter?: string | null
	stockSyncEntityMappingId?: string | null
	stockSyncLimit?: number
	stockSyncFilter?: string | null
	priceSyncEntityMappingId?: string | null
	priceSyncLimit?: number
	priceSyncFilter?: string | null
	scheduleEnabled?: boolean
	schedulePattern?: string | null
	scheduleTimezone?: string
	stockScheduleEnabled?: boolean
	stockSchedulePattern?: string | null
	stockScheduleTimezone?: string
	priceScheduleEnabled?: boolean
	priceSchedulePattern?: string | null
	priceScheduleTimezone?: string
	lastDiscoveredAt?: string | null
}

export type OneCObjectFieldDescriptor = {
	code: string
	name: string
	dataType: string | null
	nullable: boolean | null
	kind: 'property' | 'navigation'
}

export type OneCExternalObjectDescriptor = {
	code: string
	name: string
	kind: 'ODATA_ENTITY' | 'HTTP_ENDPOINT' | 'CUSTOM'
	endpoint: string | null
	fields: OneCObjectFieldDescriptor[]
}

export type OneCConnectionTestResult = {
	ok: true
	apiKind: OneCApiKind
	baseUrl: string
	status: number | null
	objectsDiscovered: number
}

export type OneCFetchRowsParams = {
	objectCode: string
	endpoint?: string | null
	limit?: number
	filter?: string | null
	select?: string[]
}
