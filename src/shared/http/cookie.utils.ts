export function readCookieValue(
	header: string | string[] | undefined,
	name: string
): string | undefined {
	const source = Array.isArray(header) ? header[0] : header
	if (!source) return undefined

	for (const part of source.split(';')) {
		const [key, ...rest] = part.trim().split('=')
		if (key === name) {
			return decodeURIComponent(rest.join('='))
		}
	}

	return undefined
}
