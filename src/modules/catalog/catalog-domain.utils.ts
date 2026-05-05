import { BadRequestException } from '@nestjs/common'
import { isIP } from 'node:net'
import { domainToASCII } from 'node:url'

const HOSTNAME_MAX_LENGTH = 253
const HOSTNAME_LABEL_MAX_LENGTH = 63
const HOSTNAME_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const BLOCKED_TLDS = new Set(['local', 'localhost', 'internal', 'home.arpa'])

function parseCsv(value: string | undefined): string[] {
	return (value ?? '')
		.split(',')
		.map(item => item.trim().toLowerCase())
		.filter(Boolean)
}

export function readCatalogBaseDomains(): string[] {
	return parseCsv(
		process.env.CATALOG_BASE_DOMAINS ?? 'myctlg.ru,myctlg-update.ru'
	)
}

export function readCatalogReservedSubdomains(): Set<string> {
	return new Set(
		parseCsv(
			process.env.CATALOG_RESERVED_SUBDOMAINS ??
				'www,api,admin,app,static,cdn,assets,shtab'
		)
	)
}

export function normalizeDomainHost(value: string): string {
	let host = value.trim().toLowerCase()
	if (!host) return ''

	host = host.replace(/^https?:\/\//, '')
	host = host.split('/')[0] ?? host
	host = host.split('?')[0] ?? host
	host = host.split('#')[0] ?? host
	host = host.replace(/\.$/, '')

	if (host.startsWith('[')) return ''
	host = host.split(':')[0] ?? host

	return domainToASCII(host) || ''
}

export function normalizeCustomDomainInput(value: string): {
	hostname: string
	inputHadWww: boolean
} {
	const rawHost = normalizeDomainHost(value)
	if (!rawHost) {
		throw new BadRequestException('Invalid domain')
	}

	const inputHadWww = rawHost.startsWith('www.')
	const hostname = inputHadWww ? rawHost.slice(4) : rawHost

	ensureCustomDomainAllowed(hostname)
	return { hostname, inputHadWww }
}

export function normalizeCaddyAskDomain(value: string): string | null {
	const host = normalizeDomainHost(value)
	if (!host || !isValidPublicHostname(host)) return null
	return host
}

export function ensureCustomDomainAllowed(hostname: string): void {
	if (!isValidPublicHostname(hostname)) {
		throw new BadRequestException('Invalid domain')
	}

	const baseDomains = readCatalogBaseDomains()
	for (const base of baseDomains) {
		if (hostname === base || hostname.endsWith(`.${base}`)) {
			throw new BadRequestException('Platform domain cannot be attached')
		}
	}
}

export function isValidPublicHostname(hostname: string): boolean {
	if (!hostname || hostname.length > HOSTNAME_MAX_LENGTH) return false
	if (hostname.includes('..')) return false
	if (isIP(hostname)) return false
	if (
		Array.from(BLOCKED_TLDS).some(
			blocked => hostname === blocked || hostname.endsWith(`.${blocked}`)
		)
	) {
		return false
	}

	const labels = hostname.split('.')
	if (labels.length < 2) return false
	if (labels.some(label => label.length === 0)) return false
	if (labels.some(label => label.length > HOSTNAME_LABEL_MAX_LENGTH)) {
		return false
	}
	if (labels.some(label => !HOSTNAME_LABEL_PATTERN.test(label))) return false

	return Boolean(labels.at(-1))
}

export function getWwwHostname(hostname: string): string {
	return hostname.startsWith('www.') ? hostname : `www.${hostname}`
}

export function stripWww(hostname: string): string {
	return hostname.startsWith('www.') ? hostname.slice(4) : hostname
}
