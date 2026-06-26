import type { AttributeEnumValueSource, DataType } from '@generated/enums'

export const PRODUCT_TYPE_COMMAND_PORT = Symbol('PRODUCT_TYPE_COMMAND_PORT')
export const PRODUCT_TYPE_SCHEMA_PORT = Symbol('PRODUCT_TYPE_SCHEMA_PORT')
export const PRODUCT_TYPE_VARIANT_ATTRIBUTES_PORT = Symbol(
	'PRODUCT_TYPE_VARIANT_ATTRIBUTES_PORT'
)

type ProductTypeMatrixEditorAttributeRecord =
	ProductTypeMatrixEditorSchemaRecord['attributes'][number]
type ProductTypeMatrixEditorEnumValueRecord =
	ProductTypeMatrixEditorAttributeRecord['attribute']['enumValues'][number]

export type ProductTypeReadOptions = {
	includeArchived?: boolean
}

export type ProductTypeAttributeCommandInput = {
	attributeId: string
	isVariant?: boolean
	isRequired?: boolean
	displayOrder?: number
}

export type ProductTypeCreateInput = {
	code?: string
	name: string
	description?: string | null
	attributes?: ProductTypeAttributeCommandInput[]
}

export type ProductTypeUpdateInput = {
	code?: string
	name?: string
	description?: string | null
	attributes?: ProductTypeAttributeCommandInput[]
	isActive?: boolean
}

export type ProductTypeArchiveResult = {
	ok: boolean
}

export type ProductTypeScopeValue = 'SYSTEM_TEMPLATE' | 'CATALOG'

export type ProductTypeAttributeSummaryRecord = {
	id: string
	key: string
	displayName: string
	dataType: DataType
}

export type ProductTypeRecordAttribute = {
	productTypeId: string
	attributeId: string
	isVariant: boolean
	isRequired: boolean
	displayOrder: number
	attribute: ProductTypeAttributeSummaryRecord
	createdAt: Date
	updatedAt: Date
}

export type ProductTypeRecord = {
	id: string
	catalogId: string | null
	scope: ProductTypeScopeValue
	code: string
	name: string
	description: string | null
	isActive: boolean
	isArchived: boolean
	archivedAt: Date | null
	attributes: ProductTypeRecordAttribute[]
	createdAt: Date
	updatedAt: Date
}

export type ProductTypeMatrixEditorEnumValueAliasRecord = {
	id: string
	attributeId: string
	catalogId: string | null
	enumValueId: string
	value: string
	displayName: string | null
}

export type ProductTypeMatrixEditorEnumValueSourceRecord = {
	id: string
	attributeId: string
	catalogId: string | null
	value: string
	displayName: string | null
	displayOrder: number
	businessId: string | null
	source: AttributeEnumValueSource
	mergedIntoId: string | null
	aliases: ProductTypeMatrixEditorEnumValueAliasRecord[]
}

export type ProductTypeMatrixEditorAttributeSourceRecord = Omit<
	ProductTypeRecordAttribute,
	'attribute' | 'createdAt' | 'updatedAt'
> & {
	attribute: ProductTypeAttributeSummaryRecord & {
		isFilterable: boolean
		isHidden: boolean
		enumValues: ProductTypeMatrixEditorEnumValueSourceRecord[]
	}
}

export type ProductTypeMatrixEditorSchemaRecord = Omit<
	ProductTypeRecord,
	'attributes'
> & {
	attributes: ProductTypeMatrixEditorAttributeSourceRecord[]
}

export type ProductTypeMatrixEditorType = Omit<
	ProductTypeMatrixEditorSchemaRecord,
	'attributes'
>

export type ProductTypeMatrixEditorAttribute = {
	productTypeId: string
	attributeId: string
	key: string
	displayName: string
	dataType: ProductTypeMatrixEditorAttributeRecord['attribute']['dataType']
	isVariant: boolean
	isRequired: boolean
	isFilterable: boolean
	isHidden: boolean
	displayOrder: number
}

export type ProductTypeMatrixEditorEnumValueAlias = {
	id: string
	attributeId: string
	catalogId: string | null
	enumValueId: string
	value: string
	displayName: string | null
}

export type ProductTypeMatrixEditorEnumValue = {
	id: string
	attributeId: string
	catalogId: string | null
	value: string
	displayName: string | null
	displayOrder: number
	businessId: string | null
	source: ProductTypeMatrixEditorEnumValueRecord['source']
	mergedIntoId: string | null
	isArchived: boolean
	aliases: ProductTypeMatrixEditorEnumValueAlias[]
}

export type ProductTypeMatrixEditorSchema = {
	type: ProductTypeMatrixEditorType
	attributes: ProductTypeMatrixEditorAttribute[]
	variantAttributes: ProductTypeMatrixEditorAttribute[]
	requiredAttributes: ProductTypeMatrixEditorAttribute[]
	enumValues: ProductTypeMatrixEditorEnumValue[]
}

export interface ProductTypeCommandPort {
	create(dto: ProductTypeCreateInput): Promise<ProductTypeRecord>
	update(id: string, dto: ProductTypeUpdateInput): Promise<ProductTypeRecord>
	archive(id: string): Promise<ProductTypeArchiveResult>
}

export interface ProductTypeSchemaPort {
	getById(id: string): Promise<ProductTypeRecord>
	getMatrixEditorSchema(id: string): Promise<ProductTypeMatrixEditorSchema>
}

export interface ProductTypeVariantAttributesPort {
	getMatrixEditorSchema(id: string): Promise<ProductTypeMatrixEditorSchema>
}
