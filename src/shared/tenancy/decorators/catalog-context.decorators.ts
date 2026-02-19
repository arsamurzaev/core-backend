import { createParamDecorator, ExecutionContext } from '@nestjs/common'

import { RequestContext } from '../request-context'

type CatalogCtxKey =
	| 'catalogId'
	| 'typeId'
	| 'catalogSlug'
	| 'host'
	| 'requestId'

export const CatalogCtx = createParamDecorator(
	(data: CatalogCtxKey | undefined, ctx: ExecutionContext) => {
		void ctx
		const store = RequestContext.mustGet()
		return data ? store[data] : store
	}
)

// Узкие декораторы — удобнее читать код
export const CatalogId = () => CatalogCtx('catalogId')
export const TypeId = () => CatalogCtx('typeId')
export const CatalogSlug = () => CatalogCtx('catalogSlug')
export const Host = () => CatalogCtx('host')
export const RequestId = () => CatalogCtx('requestId')
