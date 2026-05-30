import type {
	OneCConnectionTestResult,
	OneCExternalObjectDescriptor,
	OneCFetchRowsParams,
	OneCMetadata,
	OneCObjectFieldDescriptor
} from './one-c.types'

export class OneCClient {
	constructor(private readonly metadata: OneCMetadata) {}

	async testConnection(): Promise<OneCConnectionTestResult> {
		if (this.metadata.apiKind === 'ODATA') {
			const objects = await this.discoverObjects()
			return {
				ok: true,
				apiKind: this.metadata.apiKind,
				baseUrl: this.metadata.baseUrl,
				status: 200,
				objectsDiscovered: objects.length
			}
		}

		const response = await this.request(this.metadata.baseUrl)
		await response.text()
		return {
			ok: true,
			apiKind: this.metadata.apiKind,
			baseUrl: this.metadata.baseUrl,
			status: response.status,
			objectsDiscovered: 0
		}
	}

	async discoverObjects(): Promise<OneCExternalObjectDescriptor[]> {
		if (this.metadata.apiKind !== 'ODATA') return []

		const response = await this.request(`${this.metadata.baseUrl}/$metadata`)
		const xml = await response.text()
		return parseODataMetadata(xml, this.metadata.baseUrl)
	}

	async fetchRows(
		params: OneCFetchRowsParams
	): Promise<Record<string, unknown>[]> {
		const url = this.buildRowsUrl(params)
		const response = await this.request(url)
		const payload = await response.json().catch(async () => {
			throw new OneCClientError('ONE_C API returned non-JSON rows response')
		})

		return normalizeRowsPayload(payload)
	}

	private async request(url: string): Promise<Response> {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), this.metadata.timeoutMs)

		try {
			const response = await fetch(url, {
				method: 'GET',
				headers: this.buildHeaders(),
				signal: controller.signal
			})
			if (!response.ok) {
				throw new OneCClientError(
					`ONE_C API error ${response.status}: ${await safeResponseText(response)}`
				)
			}
			return response
		} catch (error) {
			if (error instanceof OneCClientError) throw error
			if (error instanceof Error && error.name === 'AbortError') {
				throw new OneCClientError('ONE_C API request timed out')
			}
			throw new OneCClientError(
				error instanceof Error ? error.message : 'ONE_C API request failed'
			)
		} finally {
			clearTimeout(timeout)
		}
	}

	private buildHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			Accept: 'application/json, application/xml, text/xml, */*'
		}

		if (
			this.metadata.authKind === 'BASIC' &&
			this.metadata.username &&
			this.metadata.password
		) {
			headers.Authorization = `Basic ${Buffer.from(
				`${this.metadata.username}:${this.metadata.password}`,
				'utf8'
			).toString('base64')}`
		}
		if (this.metadata.authKind === 'BEARER' && this.metadata.token) {
			headers.Authorization = `Bearer ${this.metadata.token}`
		}

		return headers
	}

	private buildRowsUrl(params: OneCFetchRowsParams): string {
		const url = resolveEndpointUrl(
			this.metadata.baseUrl,
			params.endpoint,
			params.objectCode
		)
		const limit = Math.min(100, Math.max(1, params.limit ?? 20))

		if (this.metadata.apiKind === 'ODATA') {
			url.searchParams.set('$format', 'json')
			url.searchParams.set('$top', String(limit))
			if (params.filter?.trim()) {
				url.searchParams.set('$filter', params.filter.trim())
			}
			const select = normalizeSelect(params.select)
			if (select.length) {
				url.searchParams.set('$select', select.join(','))
			}
		}

		return url.toString()
	}
}

export class OneCClientError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'OneCClientError'
	}
}

function parseODataMetadata(
	xml: string,
	baseUrl: string
): OneCExternalObjectDescriptor[] {
	const entityTypes = new Map<string, OneCObjectFieldDescriptor[]>()
	const entityTypePattern = /<EntityType\b([^>]*)>([\s\S]*?)<\/EntityType>/gi
	let entityTypeMatch: RegExpExecArray | null

	while ((entityTypeMatch = entityTypePattern.exec(xml))) {
		const entityTypeName = readXmlAttribute(entityTypeMatch[1], 'Name')
		if (!entityTypeName) continue
		entityTypes.set(entityTypeName, parseEntityTypeFields(entityTypeMatch[2]))
	}

	const objects: OneCExternalObjectDescriptor[] = []
	const entitySetPattern = /<EntitySet\b([^>]*?)\/?>/gi
	let entitySetMatch: RegExpExecArray | null

	while ((entitySetMatch = entitySetPattern.exec(xml))) {
		const code = readXmlAttribute(entitySetMatch[1], 'Name')
		if (!code) continue
		const entityType = readXmlAttribute(entitySetMatch[1], 'EntityType')
		const entityTypeName = entityType?.split('.').pop() ?? code

		objects.push({
			code,
			name: code,
			kind: 'ODATA_ENTITY',
			endpoint: `${baseUrl}/${code}`,
			fields: entityTypes.get(entityTypeName) ?? []
		})
	}

	if (objects.length) {
		return sortObjects(objects)
	}

	return sortObjects(
		[...entityTypes.entries()].map(([code, fields]) => ({
			code,
			name: code,
			kind: 'ODATA_ENTITY',
			endpoint: `${baseUrl}/${code}`,
			fields
		}))
	)
}

function parseEntityTypeFields(xml: string): OneCObjectFieldDescriptor[] {
	const fields: OneCObjectFieldDescriptor[] = []
	const propertyPattern = /<Property\b([^>]*?)\/?>/gi
	let propertyMatch: RegExpExecArray | null

	while ((propertyMatch = propertyPattern.exec(xml))) {
		const code = readXmlAttribute(propertyMatch[1], 'Name')
		if (!code) continue
		fields.push({
			code,
			name: code,
			dataType: readXmlAttribute(propertyMatch[1], 'Type'),
			nullable: parseNullable(readXmlAttribute(propertyMatch[1], 'Nullable')),
			kind: 'property'
		})
	}

	const navigationPattern = /<NavigationProperty\b([^>]*?)\/?>/gi
	let navigationMatch: RegExpExecArray | null

	while ((navigationMatch = navigationPattern.exec(xml))) {
		const code = readXmlAttribute(navigationMatch[1], 'Name')
		if (!code) continue
		fields.push({
			code,
			name: code,
			dataType: readXmlAttribute(navigationMatch[1], 'Type'),
			nullable: parseNullable(readXmlAttribute(navigationMatch[1], 'Nullable')),
			kind: 'navigation'
		})
	}

	return fields.sort((left, right) => left.code.localeCompare(right.code))
}

function readXmlAttribute(source: string, attribute: string): string | null {
	const pattern = new RegExp(`${attribute}="([^"]*)"`, 'i')
	return decodeXmlEntities(source.match(pattern)?.[1] ?? null)
}

function parseNullable(value: string | null): boolean | null {
	if (value === null) return null
	return value.toLowerCase() !== 'false'
}

function decodeXmlEntities(value: string | null): string | null {
	if (value === null) return null
	return value
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')
}

function sortObjects(
	objects: OneCExternalObjectDescriptor[]
): OneCExternalObjectDescriptor[] {
	return objects.sort((left, right) => left.code.localeCompare(right.code))
}

async function safeResponseText(response: Response): Promise<string> {
	const text = await response.text().catch(() => '')
	return text.slice(0, 500)
}

function resolveEndpointUrl(
	baseUrl: string,
	endpoint: string | null | undefined,
	objectCode: string
): URL {
	const normalizedEndpoint = endpoint?.trim()
	if (normalizedEndpoint) {
		return new URL(normalizedEndpoint, `${baseUrl.replace(/\/+$/, '')}/`)
	}

	return new URL(
		`${encodeURIComponent(objectCode)}`,
		`${baseUrl.replace(/\/+$/, '')}/`
	)
}

function normalizeSelect(select?: string[]): string[] {
	if (!select?.length) return []
	return [
		...new Set(
			select
				.map(item => item.split('.')[0]?.trim())
				.filter((item): item is string => Boolean(item))
		)
	].slice(0, 100)
}

function normalizeRowsPayload(payload: unknown): Record<string, unknown>[] {
	const rows = readRowsArray(payload)
	return rows.flatMap(row =>
		row && typeof row === 'object' && !Array.isArray(row)
			? [row as Record<string, unknown>]
			: []
	)
}

function readRowsArray(payload: unknown): unknown[] {
	if (Array.isArray(payload)) return payload
	if (!payload || typeof payload !== 'object') return []

	const record = payload as Record<string, unknown>
	if (Array.isArray(record.value)) return record.value

	const d = record.d
	if (Array.isArray(d)) return d
	if (d && typeof d === 'object') {
		const dRecord = d as Record<string, unknown>
		if (Array.isArray(dRecord.results)) return dRecord.results
	}

	return []
}
