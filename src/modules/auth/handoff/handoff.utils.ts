export function sanitizeHandoffNext(next?: string): string | undefined {
	if (!next) return undefined
	if (!next.startsWith('/')) return undefined
	if (next.startsWith('//')) return undefined
	if (next.includes('http://') || next.includes('https://')) return undefined
	return next
}

export function resolveHandoffNext(next?: string, fallback = '/admin'): string {
	return sanitizeHandoffNext(next) ?? fallback
}
