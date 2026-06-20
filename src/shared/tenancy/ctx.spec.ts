import { ForbiddenException } from '@nestjs/common'

import {
	assertCurrentCatalogCanManageCatalogContent,
	effectiveCatalogId
} from './ctx'
import { RequestContext } from './request-context'

describe('tenant ctx', () => {
	it('allows catalog content management in full catalog mode', () => {
		expect(() =>
			RequestContext.run(
				{
					requestId: 'req-1',
					host: 'store.test',
					catalogId: 'catalog-1',
					presentationMode: 'CATALOG'
				},
				() => assertCurrentCatalogCanManageCatalogContent()
			)
		).not.toThrow()
	})

	it('rejects catalog content management in business card mode', () => {
		expect(() =>
			RequestContext.run(
				{
					requestId: 'req-1',
					host: 'store.test',
					catalogId: 'catalog-1',
					presentationMode: 'BUSINESS_CARD'
				},
				() => assertCurrentCatalogCanManageCatalogContent()
			)
		).toThrow(ForbiddenException)
	})

	it('uses parent catalog as effective catalog for child reads', () => {
		const result = RequestContext.run(
			{
				requestId: 'req-1',
				host: 'store.test',
				catalogId: 'child-1',
				parentId: 'parent-1'
			},
			() => effectiveCatalogId()
		)

		expect(result).toBe('parent-1')
	})
})
