const DEFAULT_BASE_DOMAINS = ['myctlg.ru', 'myctlg-update.ru']
const DEFAULT_PLATFORM_COOKIE_SUBDOMAINS = [
	'www',
	'api',
	'admin',
	'app',
	'shtab'
]

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

export function resolveServerHost(req: {
	headers: { host?: string | string[] }
}): string {
	const host = req.headers.host
	const raw = Array.isArray(host) ? host[0] : host
	return (raw ?? '').split(':')[0] ?? ''
}

export function resolveCookieDomain(host: string): string | undefined {
	if (!host) return undefined
	const normalizedHost = host.toLowerCase().split(':')[0] ?? ''
	if (isLocalCookieHost(normalizedHost)) return undefined
	for (const base of getBaseDomains()) {
		if (normalizedHost === base) return '.' + base
		if (isPlatformCookieSubdomain(normalizedHost, base)) return '.' + base
	}
	return undefined
}

function getBaseDomains(): string[] {
	return parseCsv(process.env.CATALOG_BASE_DOMAINS, DEFAULT_BASE_DOMAINS)
}

function getPlatformCookieSubdomains(): Set<string> {
	return new Set(
		parseCsv(
			process.env.PLATFORM_COOKIE_SUBDOMAINS,
			DEFAULT_PLATFORM_COOKIE_SUBDOMAINS
		)
	)
}

function parseCsv(value: string | undefined, fallback: string[]): string[] {
	return (value ?? fallback.join(','))
		.split(',')
		.map(item => item.trim().toLowerCase())
		.filter(Boolean)
}

function isPlatformCookieSubdomain(host: string, base: string): boolean {
	if (!host.endsWith('.' + base)) return false
	const left = host.slice(0, -(base.length + 1))
	if (!left || left.includes('.')) return false
	return getPlatformCookieSubdomains().has(left)
}

function isLocalCookieHost(host: string): boolean {
	if (!host) return true
	if (host === 'localhost' || host.endsWith('.localhost')) return true
	if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true
	if (host === '[::1]' || host === '::1') return true
	return false
}
