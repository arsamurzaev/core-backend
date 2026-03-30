import { parseProductInfiniteQuery } from './product-query.utils'
import {
	normalizeProductSearchTerm,
	tokenizeProductSearchTerm
} from './product-search.utils'

describe('product search utils', () => {
	it('normalizes search term for stable matching and cache keys', () => {
		expect(normalizeProductSearchTerm('  Jeans   Slim  ')).toBe('jeans slim')
		expect(normalizeProductSearchTerm('')).toBeUndefined()
	})

	it('tokenizes search term across words and removes duplicates', () => {
		expect(
			tokenizeProductSearchTerm('  Джинсы,   slim   джинсы  HM-001  ')
		).toEqual(['джинсы', 'slim', 'hm-001'])
	})

	it('normalizes searchTerm inside infinite query parsing', () => {
		const parsed = parseProductInfiniteQuery(
			{ searchTerm: '  HM-001   Slim  ' },
			{ defaultLimit: 24, maxLimit: 50 }
		)

		expect(parsed.searchTerm).toBe('hm-001 slim')
	})
})
