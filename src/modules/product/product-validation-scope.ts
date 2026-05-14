export type ProductValidationScope = {
	catalogTypeId: string
	catalogId?: string | null
	productTypeId?: string | null
}

export type ProductValidationScopeInput = string | ProductValidationScope

export function normalizeProductValidationScope(
	scope: ProductValidationScopeInput
): ProductValidationScope {
	if (typeof scope === 'string') {
		return { catalogTypeId: scope }
	}

	return scope
}
