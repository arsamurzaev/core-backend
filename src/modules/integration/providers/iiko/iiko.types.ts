export type IikoEncryptedApiLogin = {
	format: 'enc-v1'
	alg: 'aes-256-gcm'
	keyVersion: string
	iv: string
	tag: string
	ciphertext: string
}

type IikoOpenString<T extends string> = T | (string & Record<never, never>)

export type StoredIikoMetadata = {
	apiLogin?: string
	apiLoginEncrypted?: IikoEncryptedApiLogin
	organizationId: string
	organizationName: string | null
	externalMenuId?: string | null
	externalMenuName?: string | null
	priceCategoryId?: string | null
	priceCategoryName?: string | null
	terminalGroupId?: string | null
	terminalGroupName?: string | null
	menuVersion?: number | null
	syncSource?: IikoOpenString<'external_menu' | 'nomenclature'> | null
	importImages: boolean
	exportOrders?: boolean | null
	orderExportServiceType?: IikoDeliveryOrderServiceType | null
	orderExportSourceKey?: string | null
	lastRevision: number | null
	lastMenuSyncedAt: string | null
	lastStopListSyncedAt?: string | null
	webhook?: IikoWebhookMetadata | null
}

export type IikoMetadata = {
	apiLogin: string
	organizationId: string
	organizationName: string | null
	externalMenuId: string | null
	externalMenuName: string | null
	priceCategoryId: string | null
	priceCategoryName: string | null
	terminalGroupId: string | null
	terminalGroupName: string | null
	menuVersion: number
	syncSource: 'external_menu' | 'nomenclature'
	importImages: boolean
	exportOrders: boolean
	orderExportServiceType: IikoDeliveryOrderServiceType | null
	orderExportSourceKey: string | null
	lastRevision: number | null
	lastMenuSyncedAt: string | null
	lastStopListSyncedAt: string | null
	webhook: IikoWebhookMetadata
}

export type IikoWebhookMetadata = {
	enabled: boolean
	urlPreview: string | null
	secretHash: string | null
	filterHash: string | null
	lastConfiguredAt: string | null
	lastReceivedAt: string | null
	lastEventType: IikoOpenString<IikoWebhookEventType> | null
	lastError: string | null
}

export type IikoOrganization = {
	id: string
	name: string
	code?: string | null
	isActive?: boolean | null
}

export type IikoAccessTokenResponse = {
	correlationId?: string
	token: string
}

export type IikoOrganizationsResponse = {
	correlationId?: string
	organizations: IikoOrganization[]
}

export type IikoAddressFormatType =
	| 'Legacy'
	| 'City'
	| 'International'
	| 'IntNoPostcode'

export type IikoOrganizationsSettingsRequest = {
	organizationIds?: string[] | null
	includeDisabled?: boolean | null
	parameters?: Array<'AddressFormatType' | 'RestaurantAddress'> | null
}

export type IikoOrganizationsSettingsResponse = {
	correlationId?: string
	organizations: Array<{
		id: string
		addressFormatType?: IikoAddressFormatType | null
		restaurantAddress?: string | null
	}>
}

export type IikoTerminalGroup = {
	id?: string | null
	organizationId?: string | null
	name?: string | null
	address?: string | null
	isActive?: boolean | null
}

export type IikoTerminalGroupsResponse = {
	correlationId?: string
	terminalGroups?: Array<{
		organizationId?: string | null
		items?: IikoTerminalGroup[] | null
		id?: string | null
		name?: string | null
		address?: string | null
		isActive?: boolean | null
	}> | null
	terminalGroupsInSleep?: Array<{
		organizationId?: string | null
		items?: IikoTerminalGroup[] | null
		id?: string | null
		name?: string | null
		address?: string | null
		isActive?: boolean | null
	}> | null
}

export type IikoTerminalGroupsIsAliveRequest = {
	organizationIds: string[]
	terminalGroupIds: string[]
}

export type IikoTerminalGroupAliveInfo = {
	isAlive?: boolean | null
	terminalGroupId?: string | null
	organizationId?: string | null
}

export type IikoTerminalGroupsIsAliveResponse = {
	correlationId?: string
	isAliveStatus?: IikoTerminalGroupAliveInfo[] | null
}

export type IikoStopListsRequest = {
	organizationIds: string[]
	terminalGroupIds?: string[] | null
	returnSize?: boolean | null
}

export type IikoStopListItem = {
	productId?: string | null
	sizeId?: string | null
	sku?: string | null
	balance?: number | null
	dateAdd?: string | null
}

export type IikoTerminalGroupStopListItemsGroup = {
	terminalGroupId?: string | null
	items?: IikoStopListItem[] | null
}

export type IikoTerminalGroupStopList = {
	organizationId?: string | null
	terminalGroupId?: string | null
	items?: Array<IikoStopListItem | IikoTerminalGroupStopListItemsGroup> | null
}

export type IikoStopListsResponse = {
	correlationId?: string
	terminalGroupStopLists?: IikoTerminalGroupStopList[] | null
}

export type IikoRestaurantSectionsRequest = {
	terminalGroupIds: string[]
	returnSchema?: boolean | null
	revision?: number | null
}

export type IikoRestaurantSectionTable = {
	id?: string | null
	number?: number | null
	name?: string | null
	seatingCapacity?: number | null
	revision?: number | null
	isDeleted?: boolean | null
	posId?: string | null
}

export type IikoRestaurantSection = {
	id?: string | null
	terminalGroupId?: string | null
	name?: string | null
	tables?: IikoRestaurantSectionTable[] | null
}

export type IikoRestaurantSectionsResponse = {
	correlationId?: string
	restaurantSections?: IikoRestaurantSection[] | null
	revision?: number | null
}

export type IikoExternalMenuSummary = {
	id: string
	name: string
}

export type IikoPriceCategory = {
	id: string
	name: string
}

export type IikoMenusResponse = {
	correlationId?: string
	externalMenus?: IikoExternalMenuSummary[] | null
	priceCategories?: IikoPriceCategory[] | null
}

export type IikoExternalMenuRequest = {
	externalMenuId: string
	organizationIds: string[]
	priceCategoryId?: string | null
	version?: number | null
	language?: string | null
	startRevision?: number | null
}

export type IikoExternalMenuPrice = {
	organizations?: string[] | null
	price?: number | null
	taxCategoryId?: string | null
}

export type IikoExternalMenuItemSize = {
	id?: string | null
	sizeId?: string | null
	sku?: string | null
	sizeCode?: string | null
	sizeName?: string | null
	isDefault?: boolean | null
	isHidden?: boolean | null
	buttonImageUrl?: string | null
	prices?: IikoExternalMenuPrice[] | null
	itemModifierGroups?: unknown[] | null
}

export type IikoExternalMenuItem = {
	id?: string | null
	itemId?: string | null
	sku?: string | null
	name?: string | null
	description?: string | null
	type?: IikoOpenString<'DISH' | 'COMBO'> | null
	orderItemType?: IikoOpenString<'Product' | 'Compound'> | null
	isHidden?: boolean | null
	buttonImageUrl?: string | null
	itemSizes?: IikoExternalMenuItemSize[] | null
	productCategoryId?: string | null
	measureUnit?: string | null
	measureUnitType?: string | null
	modifierSchemaId?: string | null
	modifierSchemaName?: string | null
}

export type IikoExternalMenuCategory = {
	id?: string | null
	name?: string | null
	description?: string | null
	buttonImageUrl?: string | null
	headerImageUrl?: string | null
	iikoGroupId?: string | null
	isHidden?: boolean | null
	items?: IikoExternalMenuItem[] | null
}

export type IikoExternalMenuResponse = {
	id?: string | number | null
	name?: string | null
	revision?: number | null
	formatVersion?: number | null
	itemCategories?: IikoExternalMenuCategory[] | null
	itemGroups?: IikoExternalMenuCategory[] | null
	comboCategories?: unknown[] | null
	productCategories?: unknown[] | null
}

export type IikoSyncCategory = {
	id: string
	name: string
	description?: string | null
	parentGroup?: string | null
	order?: number | null
	isDeleted?: boolean | null
	isHidden?: boolean | null
	imageLinks?: string[] | null
	rawMeta?: unknown
}

export type IikoSyncPrice = {
	currentPrice?: number | null
	isIncludedInMenu?: boolean | null
}

export type IikoSyncSizePrice = {
	sizeId?: string | null
	sizeName?: string | null
	sku?: string | null
	isDefault?: boolean | null
	imageLinks?: string[] | null
	price?: IikoSyncPrice | null
	rawMeta?: unknown
}

export type IikoSyncProduct = {
	id: string
	code?: string | null
	name: string
	description?: string | null
	additionalInfo?: string | null
	type?: IikoOpenString<'dish' | 'good' | 'modifier' | 'combo'> | null
	orderItemType?: IikoOpenString<'Product' | 'Compound'> | null
	groupId?: string | null
	productCategoryId?: string | null
	measureUnit?: string | null
	sizePrices?: IikoSyncSizePrice[] | null
	modifiers?: unknown[] | null
	groupModifiers?: unknown[] | null
	imageLinks?: string[] | null
	parentGroup?: string | null
	order?: number | null
	tags?: string[] | null
	isDeleted?: boolean | null
	isHidden?: boolean | null
	rawMeta?: unknown
}

export type IikoSyncMenu = {
	correlationId?: string
	source: 'external_menu' | 'nomenclature'
	externalMenuId?: string | null
	externalMenuName?: string | null
	groups: IikoSyncCategory[]
	products: IikoSyncProduct[]
	sizes: IikoNomenclatureSize[]
	revision?: number | null
	formatVersion?: number | null
	rawMeta?: unknown
}

export type IikoNomenclatureGroup = {
	id: string
	code?: string | null
	name: string
	description?: string | null
	parentGroup?: string | null
	order?: number | null
	isIncludedInMenu?: boolean | null
	isGroupModifier?: boolean | null
	isDeleted?: boolean | null
	imageLinks?: string[] | null
	tags?: string[] | null
}

export type IikoNomenclatureSize = {
	id: string
	name: string
	priority?: number | null
	isDefault?: boolean | null
}

export type IikoNomenclaturePrice = {
	currentPrice?: number | null
	isIncludedInMenu?: boolean | null
	nextPrice?: number | null
	nextIncludedInMenu?: boolean | null
	nextDatePrice?: string | null
}

export type IikoNomenclatureSizePrice = {
	sizeId?: string | null
	price?: IikoNomenclaturePrice | null
}

export type IikoNomenclatureModifier = {
	id: string
	defaultAmount?: number | null
	minAmount?: number | null
	maxAmount?: number | null
	required?: boolean | null
	hideIfDefaultAmount?: boolean | null
	splittable?: boolean | null
	freeOfChargeAmount?: number | null
}

export type IikoNomenclatureGroupModifier = IikoNomenclatureModifier & {
	childModifiers?: IikoNomenclatureModifier[] | null
}

export type IikoNomenclatureProduct = {
	id: string
	code?: string | null
	name: string
	description?: string | null
	additionalInfo?: string | null
	type?: IikoOpenString<'dish' | 'good' | 'modifier'> | null
	orderItemType?: IikoOpenString<'Product' | 'Compound'> | null
	groupId?: string | null
	productCategoryId?: string | null
	measureUnit?: string | null
	sizePrices?: IikoNomenclatureSizePrice[] | null
	modifiers?: IikoNomenclatureModifier[] | null
	groupModifiers?: IikoNomenclatureGroupModifier[] | null
	imageLinks?: string[] | null
	parentGroup?: string | null
	order?: number | null
	tags?: string[] | null
	isDeleted?: boolean | null
}

export type IikoNomenclatureResponse = {
	correlationId?: string
	groups: IikoNomenclatureGroup[]
	productCategories?: unknown[]
	products: IikoNomenclatureProduct[]
	sizes: IikoNomenclatureSize[]
	revision?: number | null
}

export type IikoDeliveryOrderServiceType =
	| 'DeliveryByCourier'
	| 'DeliveryByClient'

export type IikoCreateDeliveryOrderItem = {
	type: 'Product'
	productId: string
	productSizeId?: string | null
	amount: number
	price: number
	comment?: string | null
	positionId?: string | null
}

export type IikoDeliveryPointAddressCity = {
	type: 'city'
	line1: string
	flat?: string | null
	entrance?: string | null
	floor?: string | null
	doorphone?: string | null
	regionId?: string | null
}

export type IikoDeliveryPointAddressLegacy = {
	type: 'legacy'
	street: {
		classifierId?: string | null
		id?: string | null
		name?: string | null
		city?: string | null
	}
	house: string
	index?: string | null
	building?: string | null
	flat?: string | null
	entrance?: string | null
	floor?: string | null
	doorphone?: string | null
	regionId?: string | null
}

export type IikoDeliveryPoint = {
	coordinates?: {
		latitude: number
		longitude: number
	} | null
	address?: IikoDeliveryPointAddressCity | IikoDeliveryPointAddressLegacy | null
	externalCartographyId?: string | null
	comment?: string | null
}

export type IikoCreateDeliveryOrderPayload = {
	organizationId: string
	terminalGroupId?: string | null
	createOrderSettings?: {
		transportToFrontTimeout?: number | null
		checkStopList?: boolean
	} | null
	order: {
		id?: string | null
		externalNumber?: string | null
		phone: string
		orderServiceType?: IikoDeliveryOrderServiceType | null
		orderTypeId?: string | null
		completeBefore?: string | null
		menuId?: string | null
		priceCategoryId?: string | null
		comment?: string | null
		customer?: {
			type: 'one-time'
			name: string
		} | null
		deliveryPoint?: IikoDeliveryPoint | null
		items: IikoCreateDeliveryOrderItem[]
		sourceKey?: string | null
		externalData?: Array<{
			key: string
			value: string
			isPublic?: boolean
		}> | null
	}
}

export type IikoCreateDeliveryOrderResponse = {
	correlationId: string
	orderInfo: {
		id: string
		posId?: string | null
		externalNumber?: string | null
		organizationId: string
		timestamp: number
		creationStatus: IikoOpenString<'Success' | 'InProgress' | 'Error'>
		errorInfo?: unknown
		order?: unknown
	}
}

export type IikoCreateReservePayload = {
	organizationId: string
	terminalGroupId?: string | null
	id?: string | null
	externalNumber?: string | null
	order?: {
		menuId?: string | null
		items: IikoCreateDeliveryOrderItem[]
		sourceKey?: string | null
		orderTypeId?: string | null
		externalData?: Array<{
			key: string
			value: string
			isPublic?: boolean
		}> | null
	} | null
	customer: {
		type: 'regular'
		id?: string | null
		name?: string | null
	}
	phone: string
	comment?: string | null
	durationInMinutes: number
	shouldRemind: boolean
	tableIds: string[]
	estimatedStartTime: string
	guests?: {
		count: number
	} | null
	eventType?: string | null
	createReserveSettings?: {
		transportToFrontTimeout?: number | null
		checkStopList?: boolean
	} | null
}

export type IikoCreateReserveResponse = {
	correlationId: string
	reserveInfo: {
		id: string
		externalNumber?: string | null
		organizationId: string
		timestamp: number
		creationStatus: IikoOpenString<'Success' | 'InProgress' | 'Error'>
		errorInfo?: unknown
		isDeleted?: boolean
		reserve?: unknown
	}
}

export type IikoCreateTableOrderPayload = {
	organizationId: string
	terminalGroupId: string
	createOrderSettings?: {
		servicePrint?: boolean | null
		transportToFrontTimeout?: number | null
		checkStopList?: boolean
	} | null
	order: {
		id?: string | null
		externalNumber?: string | null
		tableIds?: string[] | null
		phone?: string | null
		guests?: {
			count: number
		} | null
		tabName?: string | null
		menuId?: string | null
		priceCategoryId?: string | null
		items: IikoCreateDeliveryOrderItem[]
		sourceKey?: string | null
		externalData?: Array<{
			key: string
			value: string
			isPublic?: boolean
		}> | null
	}
}

export type IikoCreateTableOrderResponse = IikoCreateDeliveryOrderResponse

export type IikoCommandStatusResponse = {
	state: IikoOpenString<'InProgress' | 'Success' | 'Error'>
	errorReason?: string | null
	exception?: unknown
}

export type IikoWebhookEventType =
	| 'DeliveryOrderUpdate'
	| 'DeliveryOrderError'
	| 'ReserveUpdate'
	| 'ReserveError'
	| 'TableOrderUpdate'
	| 'TableOrderError'
	| 'StopListUpdate'
	| 'PersonalShift'
	| 'KitchenOrderUpdate'
	| 'NomenclatureUpdate'
	| 'BusinessHoursAndMappingUpdate'

export type IikoDeliveryOrderStatus =
	| 'Unconfirmed'
	| 'WaitCooking'
	| 'ReadyForCooking'
	| 'CookingStarted'
	| 'CookingCompleted'
	| 'Waiting'
	| 'OnWay'
	| 'Delivered'
	| 'Closed'
	| 'Cancelled'

export type IikoTableOrderStatus = 'New' | 'Bill' | 'Closed' | 'Deleted'

export type IikoOrderItemStatus =
	| 'Added'
	| 'PrintedNotCooking'
	| 'CookingStarted'
	| 'CookingCompleted'
	| 'Served'

export type IikoWebhookSettingsFilter = {
	deliveryOrderFilter?: {
		orderStatuses?: IikoDeliveryOrderStatus[] | null
		itemStatuses?: IikoOrderItemStatus[] | null
		errors?: boolean | null
		returnedExternalDataKeys?: string[] | null
	} | null
	tableOrderFilter?: {
		orderStatuses?: IikoTableOrderStatus[] | null
		itemStatuses?: IikoOrderItemStatus[] | null
		errors?: boolean | null
	} | null
	reserveFilter?: {
		updates?: boolean | null
		errors?: boolean | null
	} | null
	stopListUpdateFilter?: {
		updates?: boolean | null
	} | null
	personalShiftFilter?: {
		updates?: boolean | null
	} | null
	nomenclatureUpdateFilter?: {
		updates?: boolean | null
	} | null
	businessHoursAndMappingUpdateFilter?: {
		updates?: boolean | null
	} | null
}

export type IikoWebhookSettingsResponse = {
	correlationId?: string
	apiLoginName?: string | null
	webHooksUri?: string | null
	authToken?: string | null
	webHooksFilter?: IikoWebhookSettingsFilter | null
}

export type IikoUpdateWebhookSettingsRequest = {
	organizationId: string
	webHooksUri: string
	authToken?: string | null
	webHooksFilter?: IikoWebhookSettingsFilter | null
}

export type IikoUpdateWebhookSettingsResponse = {
	correlationId?: string
}
