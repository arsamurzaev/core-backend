export const PRODUCT_TYPE_COMMAND_PORT = Symbol('PRODUCT_TYPE_COMMAND_PORT')
export const PRODUCT_TYPE_SCHEMA_PORT = Symbol('PRODUCT_TYPE_SCHEMA_PORT')
export const PRODUCT_TYPE_VARIANT_ATTRIBUTES_PORT = Symbol(
	'PRODUCT_TYPE_VARIANT_ATTRIBUTES_PORT'
)

export interface ProductTypeCommandPort {
	create(...args: unknown[]): Promise<unknown>
	update(id: string, ...args: unknown[]): Promise<unknown>
	archive(id: string): Promise<unknown>
}

export interface ProductTypeSchemaPort {
	getById(id: string): Promise<unknown>
	getMatrixEditorSchema(id: string): Promise<unknown>
}

export interface ProductTypeVariantAttributesPort {
	getMatrixEditorSchema(id: string): Promise<unknown>
}
