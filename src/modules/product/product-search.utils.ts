const PRODUCT_SEARCH_TERM_MAX_LENGTH = 160
const PRODUCT_SEARCH_TOKEN_MAX_LENGTH = 64
const PRODUCT_SEARCH_MAX_TOKENS = 6
const PRODUCT_SEARCH_WHITESPACE_RE = /\s+/g
const PRODUCT_SEARCH_EDGE_PUNCTUATION_RE =
	/^[^\p{L}\p{N}_-]+|[^\p{L}\p{N}_-]+$/gu

export function normalizeProductSearchTerm(value?: string): string | undefined {
	if (!value) return undefined

	const normalized = value
		.normalize('NFKC')
		.replace(PRODUCT_SEARCH_WHITESPACE_RE, ' ')
		.trim()
		.toLowerCase()

	if (!normalized) return undefined

	return normalized.slice(0, PRODUCT_SEARCH_TERM_MAX_LENGTH)
}

export function tokenizeProductSearchTerm(value?: string): string[] {
	const normalized = normalizeProductSearchTerm(value)
	if (!normalized) return []

	const tokens: string[] = []
	const seen = new Set<string>()

	for (const rawToken of normalized.split(' ')) {
		const token = sanitizeProductSearchToken(rawToken)
		if (!token || seen.has(token)) continue

		tokens.push(token)
		seen.add(token)

		if (tokens.length >= PRODUCT_SEARCH_MAX_TOKENS) {
			break
		}
	}

	return tokens
}

function sanitizeProductSearchToken(token: string): string {
	return token
		.replace(PRODUCT_SEARCH_EDGE_PUNCTUATION_RE, '')
		.slice(0, PRODUCT_SEARCH_TOKEN_MAX_LENGTH)
}
