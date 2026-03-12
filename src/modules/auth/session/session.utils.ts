export type SessionUserAgent = {
	raw: string | null
	browser: { name: string | null; version: string | null }
	os: { name: string | null; version: string | null }
	device: { type: string | null; vendor: string | null; model: string | null }
	engine: { name: string | null; version: string | null }
}

export type SessionGeo = {
	city: string | null
	region: string | null
	latitude: number | null
	longitude: number | null
}

export type SessionClient = {
	ip: string | null
	userAgent: SessionUserAgent | null
	geo: SessionGeo | null
}

export type SessionContext = {
	catalogId: string | null
}

export type SessionData = {
	userId: string
	csrf: string
	createdAt: number
	client: SessionClient
	context: SessionContext
}

export type SessionLoginEntry = {
	sid: string
	createdAt: number
	isPrimary: boolean
	client: SessionClient
	context: SessionContext
}

export type SessionMeta = {
	ip?: string | null
	userAgent?: string | null
	catalogId?: string | null
}

type GeoLookupRecord = {
	ll?: unknown
	city?: unknown
	region?: unknown
}

const DEV_GEO: SessionGeo = {
	city: 'Moscow',
	region: 'Moscow',
	latitude: 55.7558,
	longitude: 37.6173
}

const BROWSER_RULES: ReadonlyArray<[string, RegExp]> = [
	['Edge', /EdgA?\/([\d.]+)/],
	['Opera', /OPR\/([\d.]+)/],
	['Opera', /Opera\/([\d.]+)/],
	['Vivaldi', /Vivaldi\/([\d.]+)/],
	['Brave', /Brave\/([\d.]+)/],
	['Yandex', /YaBrowser\/([\d.]+)/],
	['Chrome', /Chrome\/([\d.]+)/],
	['Chrome', /CriOS\/([\d.]+)/],
	['Firefox', /Firefox\/([\d.]+)/],
	['Firefox', /FxiOS\/([\d.]+)/],
	['Safari', /Version\/([\d.]+).*Safari\//],
	['IE', /MSIE\s([\d.]+)/],
	['IE', /Trident\/.*rv:([\d.]+)/]
]

const WINDOWS_VERSION_MAP: Record<string, string> = {
	'10.0': '10',
	'6.3': '8.1',
	'6.2': '8',
	'6.1': '7',
	'6.0': 'Vista',
	'5.1': 'XP',
	'5.0': '2000'
}

const BLINK_BROWSERS = new Set([
	'Chrome',
	'Edge',
	'Opera',
	'Vivaldi',
	'Brave',
	'Yandex'
])

export function buildSessionContext(meta: SessionMeta): SessionContext {
	return {
		catalogId: cleanSessionValue(meta.catalogId)
	}
}

export function buildSessionClient(
	meta: SessionMeta,
	options: {
		isDev: boolean
		geoLookup?: (value: string) => unknown
	}
): SessionClient {
	const ip = normalizeSessionIp(meta.ip)
	const userAgentRaw = cleanSessionValue(meta.userAgent)
	const userAgent = parseSessionUserAgent(userAgentRaw)
	const geo = resolveSessionGeo(ip, options)

	return { ip, userAgent, geo }
}

export function parseStoredSessionData(raw: string | null): SessionData | null {
	if (!raw) return null

	try {
		return JSON.parse(raw) as SessionData
	} catch {
		return null
	}
}

function cleanSessionValue(value?: string | null): string | null {
	const trimmed = (value ?? '').trim()
	return trimmed || null
}

function normalizeSessionIp(ip?: string | null): string | null {
	let value = cleanSessionValue(ip)
	if (!value) return null
	if (value.startsWith('::ffff:')) value = value.slice(7)
	if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(value)) {
		value = value.split(':')[0] ?? value
	}
	return value
}

function parseFiniteNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value)
		if (Number.isFinite(parsed)) return parsed
	}
	return null
}

function extractVersion(ua: string, pattern: RegExp): string | null {
	const match = ua.match(pattern)
	if (!match?.[1]) return null
	return match[1].replace(/_/g, '.')
}

function parseSessionUserAgent(
	userAgent: string | null
): SessionUserAgent | null {
	if (!userAgent) return null
	const ua = userAgent

	let browserName: string | null = null
	let browserVersion: string | null = null

	for (const [name, pattern] of BROWSER_RULES) {
		const version = extractVersion(ua, pattern)
		if (version) {
			browserName = name
			browserVersion = version
			break
		}
	}

	let osName: string | null = null
	let osVersion: string | null = null

	const windowsVersion = extractVersion(ua, /Windows NT ([\d.]+)/)
	if (windowsVersion) {
		osName = 'Windows'
		osVersion = WINDOWS_VERSION_MAP[windowsVersion] ?? windowsVersion
	} else {
		const macVersion = extractVersion(ua, /Mac OS X ([\d_]+)/)
		if (macVersion) {
			osName = 'macOS'
			osVersion = macVersion
		} else {
			const iosVersion =
				extractVersion(ua, /iPhone OS ([\d_]+)/) ??
				extractVersion(ua, /iPad.*OS ([\d_]+)/)
			if (iosVersion) {
				osName = ua.includes('iPad') ? 'iPadOS' : 'iOS'
				osVersion = iosVersion
			} else {
				const androidVersion = extractVersion(ua, /Android ([\d.]+)/)
				if (androidVersion) {
					osName = 'Android'
					osVersion = androidVersion
				} else if (/CrOS/.test(ua)) {
					osName = 'Chrome OS'
				} else if (/Linux/.test(ua)) {
					osName = 'Linux'
				}
			}
		}
	}

	let deviceType: string | null = null
	let deviceVendor: string | null = null
	let deviceModel: string | null = null

	if (/iPad/.test(ua)) {
		deviceType = 'tablet'
		deviceVendor = 'Apple'
		deviceModel = 'iPad'
	} else if (/iPhone/.test(ua)) {
		deviceType = 'mobile'
		deviceVendor = 'Apple'
		deviceModel = 'iPhone'
	} else if (/Android/.test(ua)) {
		deviceType = /Mobile/.test(ua) ? 'mobile' : 'tablet'
	} else if (/Mobile/.test(ua)) {
		deviceType = 'mobile'
	}

	let engineName: string | null = null
	let engineVersion: string | null = null

	if (browserName && BLINK_BROWSERS.has(browserName)) {
		engineName = 'Blink'
	} else if (/AppleWebKit\/([\d.]+)/.test(ua)) {
		engineName = 'WebKit'
		engineVersion = extractVersion(ua, /AppleWebKit\/([\d.]+)/)
	} else if (/Gecko\/([\d.]+)/.test(ua)) {
		engineName = 'Gecko'
		engineVersion = extractVersion(ua, /Gecko\/([\d.]+)/)
	} else if (/Trident\/([\d.]+)/.test(ua)) {
		engineName = 'Trident'
		engineVersion = extractVersion(ua, /Trident\/([\d.]+)/)
	}

	return {
		raw: userAgent,
		browser: { name: browserName, version: browserVersion },
		os: { name: osName, version: osVersion },
		device: { type: deviceType, vendor: deviceVendor, model: deviceModel },
		engine: { name: engineName, version: engineVersion }
	}
}

function resolveSessionGeo(
	ip: string | null,
	options: {
		isDev: boolean
		geoLookup?: (value: string) => unknown
	}
): SessionGeo | null {
	if (options.isDev) return DEV_GEO
	if (!ip || !options.geoLookup) return null

	try {
		const lookup = options.geoLookup(ip)
		if (!isGeoLookupRecord(lookup)) {
			return null
		}

		const coordinates = Array.isArray(lookup.ll) ? lookup.ll : []
		const latitude = parseFiniteNumber(coordinates[0])
		const longitude = parseFiniteNumber(coordinates[1])
		const city = typeof lookup.city === 'string' ? lookup.city : null
		const region = typeof lookup.region === 'string' ? lookup.region : null

		return {
			city,
			region,
			latitude,
			longitude
		}
	} catch {
		return null
	}
}

function isGeoLookupRecord(value: unknown): value is GeoLookupRecord {
	return Boolean(value) && typeof value === 'object'
}
