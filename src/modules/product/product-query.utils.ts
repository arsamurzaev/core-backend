import { DataType } from '@generated/enums'
import { BadRequestException } from '@nestjs/common'

import type {
	ProductAttributeFilter,
	ProductDefaultPageCursor,
	ProductSeededPageCursor
} from './product.repository'

type ScalarQueryValue = string | number | boolean | bigint

type RawAttributeFilterState = {
	values: string[]
	min?: string
	max?: string
	bool?: boolean
}

type AttributeFilterResolutionMeta = {
	id: string
	key: string
	dataType: DataType
	isVariantAttribute: boolean
}

type InfiniteLimitOptions = {
	defaultLimit: number
	maxLimit: number
}

export type ParsedAttributeFilter = {
	key: string
	values: string[]
	min?: string
	max?: string
	bool?: boolean
}

export type ParsedProductInfiniteQuery = {
	cursor?: string
	limit: number
	seed?: string
	categoryIds: string[]
	brandIds: string[]
	minPrice?: number
	maxPrice?: number
	searchTerm?: string
	isPopular?: boolean
	isDiscount?: boolean
	attributeFilters: ParsedAttributeFilter[]
}

export type DecodedInfiniteCursor =
	| {
			mode: 'default'
			cursor: ProductDefaultPageCursor
	  }
	| {
			mode: 'seed'
			seed: string
			cursor: ProductSeededPageCursor
	  }

function isScalarQueryValue(value: unknown): value is ScalarQueryValue {
	return (
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean' ||
		typeof value === 'bigint'
	)
}

function normalizeScalarQueryValue(value: ScalarQueryValue): string {
	return String(value).trim()
}

export function parseProductInfiniteQuery(
	query: Record<string, unknown>,
	options: InfiniteLimitOptions
): ParsedProductInfiniteQuery {
	const limit = normalizeInfiniteLimit(getSingleQueryValue(query.limit), options)
	const seedRaw = getSingleQueryValue(query.seed)
	const seed = seedRaw ? seedRaw : undefined
	const minPrice = parseOptionalNumber(
		getSingleQueryValue(query.minPrice),
		'minPrice'
	)
	const maxPrice = parseOptionalNumber(
		getSingleQueryValue(query.maxPrice),
		'maxPrice'
	)

	if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
		throw new BadRequestException('minPrice не может быть больше maxPrice')
	}

	return {
		cursor: getSingleQueryValue(query.cursor),
		limit,
		seed,
		categoryIds: extractCsvValues(query.categories),
		brandIds: extractCsvValues(query.brands),
		minPrice,
		maxPrice,
		searchTerm: getSingleQueryValue(query.searchTerm),
		isPopular: parseOptionalBoolean(
			getSingleQueryValue(query.isPopular),
			'isPopular'
		),
		isDiscount: parseOptionalBoolean(
			getSingleQueryValue(query.isDiscount),
			'isDiscount'
		),
		attributeFilters: parseAttributeFilters(query)
	}
}

export function resolveProductAttributeFilter(
	meta: AttributeFilterResolutionMeta,
	filter: ParsedAttributeFilter
): ProductAttributeFilter {
	switch (meta.dataType) {
		case DataType.ENUM: {
			if (
				filter.bool !== undefined ||
				filter.min !== undefined ||
				filter.max !== undefined
			) {
				throw new BadRequestException(
					`Для ENUM-атрибута ${meta.key} поддерживаются только значения`
				)
			}

			const values = uniqueNonEmptyValues(filter.values.map(value => value.trim()))
			if (!values.length) {
				throw new BadRequestException(
					`Для атрибута ${meta.key} нужно передать значения`
				)
			}

			return meta.isVariantAttribute
				? { kind: 'variant-enum', attributeId: meta.id, values }
				: { kind: 'enum', attributeId: meta.id, values }
		}
		case DataType.STRING: {
			if (
				filter.bool !== undefined ||
				filter.min !== undefined ||
				filter.max !== undefined
			) {
				throw new BadRequestException(
					`Для STRING-атрибута ${meta.key} поддерживаются только значения`
				)
			}

			const values = uniqueNonEmptyValues(filter.values.map(value => value.trim()))
			if (!values.length) {
				throw new BadRequestException(
					`Для атрибута ${meta.key} нужно передать значения`
				)
			}

			return { kind: 'string', attributeId: meta.id, values }
		}
		case DataType.BOOLEAN: {
			if (filter.min !== undefined || filter.max !== undefined) {
				throw new BadRequestException(
					`Для BOOLEAN-атрибута ${meta.key} min/max не поддерживаются`
				)
			}
			if (filter.values.length > 1) {
				throw new BadRequestException(
					`Для BOOLEAN-атрибута ${meta.key} нужно одно значение`
				)
			}

			const value =
				filter.bool ??
				(filter.values.length
					? parseBooleanStrict(filter.values[0], `attr.${meta.key}`)
					: undefined)
			if (value === undefined) {
				throw new BadRequestException(
					`Для атрибута ${meta.key} нужно передать true или false`
				)
			}

			return { kind: 'boolean', attributeId: meta.id, value }
		}
		case DataType.INTEGER: {
			if (filter.bool !== undefined) {
				throw new BadRequestException(
					`Для INTEGER-атрибута ${meta.key} bool не поддерживается`
				)
			}

			const values = filter.values.map(value =>
				parseInteger(value, `attr.${meta.key}`)
			)
			const min =
				filter.min !== undefined
					? parseInteger(filter.min, `attrMin.${meta.key}`)
					: undefined
			const max =
				filter.max !== undefined
					? parseInteger(filter.max, `attrMax.${meta.key}`)
					: undefined

			if (!values.length && min === undefined && max === undefined) {
				throw new BadRequestException(
					`Для атрибута ${meta.key} нужно передать value, min или max`
				)
			}
			if (min !== undefined && max !== undefined && min > max) {
				throw new BadRequestException(
					`attrMin.${meta.key} не может быть больше attrMax.${meta.key}`
				)
			}

			return { kind: 'integer', attributeId: meta.id, values, min, max }
		}
		case DataType.DECIMAL: {
			if (filter.bool !== undefined) {
				throw new BadRequestException(
					`Для DECIMAL-атрибута ${meta.key} bool не поддерживается`
				)
			}

			const values = filter.values.map(value =>
				parseDecimal(value, `attr.${meta.key}`)
			)
			const min =
				filter.min !== undefined
					? parseDecimal(filter.min, `attrMin.${meta.key}`)
					: undefined
			const max =
				filter.max !== undefined
					? parseDecimal(filter.max, `attrMax.${meta.key}`)
					: undefined

			if (!values.length && min === undefined && max === undefined) {
				throw new BadRequestException(
					`Для атрибута ${meta.key} нужно передать value, min или max`
				)
			}
			if (min !== undefined && max !== undefined && min > max) {
				throw new BadRequestException(
					`attrMin.${meta.key} не может быть больше attrMax.${meta.key}`
				)
			}

			return { kind: 'decimal', attributeId: meta.id, values, min, max }
		}
		case DataType.DATETIME: {
			if (filter.bool !== undefined) {
				throw new BadRequestException(
					`Для DATETIME-атрибута ${meta.key} bool не поддерживается`
				)
			}

			const values = filter.values.map(value =>
				parseDate(value, `attr.${meta.key}`)
			)
			const min =
				filter.min !== undefined
					? parseDate(filter.min, `attrMin.${meta.key}`)
					: undefined
			const max =
				filter.max !== undefined
					? parseDate(filter.max, `attrMax.${meta.key}`)
					: undefined

			if (!values.length && min === undefined && max === undefined) {
				throw new BadRequestException(
					`Для атрибута ${meta.key} нужно передать value, min или max`
				)
			}
			if (
				min !== undefined &&
				max !== undefined &&
				min.getTime() > max.getTime()
			) {
				throw new BadRequestException(
					`attrMin.${meta.key} не может быть больше attrMax.${meta.key}`
				)
			}

			return { kind: 'datetime', attributeId: meta.id, values, min, max }
		}
		default:
			throw new BadRequestException(
				`Тип атрибута ${meta.key} не поддерживается в фильтре`
			)
	}
}

export function decodeProductInfiniteCursor(
	raw?: string
): DecodedInfiniteCursor | null {
	if (!raw) return null

	try {
		const decoded = Buffer.from(raw, 'base64').toString('utf8')
		const payload = JSON.parse(decoded) as {
			mode?: unknown
			id?: unknown
			updatedAt?: unknown
			score?: unknown
			seed?: unknown
		}

		if (payload.mode === 'default') {
			const id = typeof payload.id === 'string' ? payload.id.trim() : ''
			const updatedAtRaw =
				typeof payload.updatedAt === 'string' ? payload.updatedAt.trim() : undefined
			if (!id || !updatedAtRaw) return null

			const updatedAt = new Date(updatedAtRaw)
			if (Number.isNaN(updatedAt.getTime())) return null

			return {
				mode: 'default',
				cursor: { id, updatedAt }
			}
		}

		if (payload.mode === 'seed') {
			const id = typeof payload.id === 'string' ? payload.id.trim() : ''
			const score = typeof payload.score === 'string' ? payload.score.trim() : ''
			const seed = typeof payload.seed === 'string' ? payload.seed.trim() : ''
			if (!id || !score || !seed) return null

			return {
				mode: 'seed',
				seed,
				cursor: { id, score }
			}
		}

		return null
	} catch {
		return null
	}
}

export function encodeProductDefaultCursor(
	cursor: ProductDefaultPageCursor
): string {
	return Buffer.from(
		JSON.stringify({
			mode: 'default',
			id: cursor.id,
			updatedAt: cursor.updatedAt.toISOString()
		})
	).toString('base64')
}

export function encodeProductSeedCursor(
	seed: string,
	cursor: ProductSeededPageCursor
): string {
	return Buffer.from(
		JSON.stringify({
			mode: 'seed',
			id: cursor.id,
			score: cursor.score,
			seed
		})
	).toString('base64')
}

export function uniqueNonEmptyValues(values: string[]): string[] {
	return Array.from(new Set(values.filter(Boolean)))
}

function parseAttributeFilters(
	query: Record<string, unknown>
): ParsedAttributeFilter[] {
	const stateByKey = new Map<string, RawAttributeFilterState>()
	const rawAttributesJson = getSingleQueryValue(query.attributes)

	if (rawAttributesJson) {
		let parsed: unknown
		try {
			parsed = JSON.parse(rawAttributesJson)
		} catch {
			throw new BadRequestException(
				'attributes должен быть валидным JSON-объектом'
			)
		}

		if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
			throw new BadRequestException(
				'attributes должен быть JSON-объектом вида {"key": value}'
			)
		}

		for (const [rawKey, rawValue] of Object.entries(parsed)) {
			const key = normalizeAttributeKey(rawKey)
			const state = ensureAttributeState(stateByKey, key)
			applyAttributeJsonValue(state, rawValue)
		}
	}

	for (const [rawKey, rawValue] of Object.entries(query)) {
		if (rawKey.startsWith('attr.')) {
			const key = normalizeAttributeKey(rawKey.slice('attr.'.length))
			const state = ensureAttributeState(stateByKey, key)
			state.values.push(...extractCsvValues(rawValue))
			continue
		}

		if (rawKey.startsWith('attrMin.')) {
			const key = normalizeAttributeKey(rawKey.slice('attrMin.'.length))
			const state = ensureAttributeState(stateByKey, key)
			state.min = getSingleQueryValue(rawValue)
			continue
		}

		if (rawKey.startsWith('attrMax.')) {
			const key = normalizeAttributeKey(rawKey.slice('attrMax.'.length))
			const state = ensureAttributeState(stateByKey, key)
			state.max = getSingleQueryValue(rawValue)
			continue
		}

		if (rawKey.startsWith('attrBool.')) {
			const key = normalizeAttributeKey(rawKey.slice('attrBool.'.length))
			const state = ensureAttributeState(stateByKey, key)
			state.bool = parseOptionalBoolean(
				getSingleQueryValue(rawValue),
				`attrBool.${key}`
			)
		}
	}

	return Array.from(stateByKey.entries())
		.map(([key, state]) => ({
			key,
			values: uniqueNonEmptyValues(state.values.map(value => value.trim())),
			min: state.min?.trim() || undefined,
			max: state.max?.trim() || undefined,
			bool: state.bool
		}))
		.filter(
			state =>
				state.values.length > 0 ||
				state.min !== undefined ||
				state.max !== undefined ||
				state.bool !== undefined
		)
}

function normalizeInfiniteLimit(
	value: string | undefined,
	options: InfiniteLimitOptions
): number {
	if (!value) return options.defaultLimit

	const parsed = Number(value)
	if (!Number.isFinite(parsed)) return options.defaultLimit

	const normalized = Math.floor(parsed)
	if (normalized <= 0) return options.defaultLimit

	return Math.min(normalized, options.maxLimit)
}

function getSingleQueryValue(raw: unknown): string | undefined {
	if (Array.isArray(raw)) {
		for (const item of raw) {
			const normalized = getSingleQueryValue(item)
			if (normalized) return normalized
		}
		return undefined
	}

	if (!isScalarQueryValue(raw)) return undefined

	const normalized = normalizeScalarQueryValue(raw)
	return normalized || undefined
}

function extractCsvValues(raw: unknown): string[] {
	if (Array.isArray(raw)) {
		return uniqueNonEmptyValues(raw.flatMap(item => extractCsvValues(item)))
	}
	if (!isScalarQueryValue(raw)) return []

	return uniqueNonEmptyValues(
		normalizeScalarQueryValue(raw)
			.split(',')
			.map(item => item.trim())
	)
}

function parseOptionalBoolean(
	value: string | undefined,
	field: string
): boolean | undefined {
	if (value === undefined) return undefined
	return parseBooleanStrict(value, field)
}

function parseBooleanStrict(value: string, field: string): boolean {
	const normalized = value.trim().toLowerCase()
	if (normalized === 'true' || normalized === '1') return true
	if (normalized === 'false' || normalized === '0') return false

	throw new BadRequestException(`Поле ${field} должно быть true/false`)
}

function parseOptionalNumber(
	value: string | undefined,
	field: string
): number | undefined {
	if (value === undefined) return undefined

	const parsed = Number(value)
	if (!Number.isFinite(parsed)) {
		throw new BadRequestException(`Поле ${field} должно быть числом`)
	}

	return parsed
}

function parseInteger(value: string, field: string): number {
	const parsed = Number(value)
	if (!Number.isInteger(parsed)) {
		throw new BadRequestException(`Поле ${field} должно быть целым числом`)
	}

	return parsed
}

function parseDecimal(value: string, field: string): number {
	const parsed = Number(value)
	if (!Number.isFinite(parsed)) {
		throw new BadRequestException(`Поле ${field} должно быть числом`)
	}

	return parsed
}

function parseDate(value: string, field: string): Date {
	const parsed = new Date(value)
	if (Number.isNaN(parsed.getTime())) {
		throw new BadRequestException(`Поле ${field} должно быть датой`)
	}

	return parsed
}

function normalizeAttributeKey(value: string): string {
	const normalized = value.trim().toLowerCase()
	if (!normalized) {
		throw new BadRequestException('Ключ атрибута фильтра не может быть пустым')
	}

	return normalized
}

function ensureAttributeState(
	map: Map<string, RawAttributeFilterState>,
	key: string
): RawAttributeFilterState {
	let state = map.get(key)
	if (!state) {
		state = { values: [] }
		map.set(key, state)
	}

	return state
}

function applyAttributeJsonValue(
	state: RawAttributeFilterState,
	value: unknown
): void {
	if (value === null || value === undefined) return

	if (Array.isArray(value)) {
		state.values.push(
			...value
				.map(item =>
					item === null || item === undefined || !isScalarQueryValue(item)
						? ''
						: normalizeScalarQueryValue(item)
				)
				.filter(Boolean)
		)
		return
	}

	if (typeof value === 'boolean') {
		state.bool = value
		return
	}

	if (typeof value === 'number' || typeof value === 'string') {
		state.values.push(String(value))
		return
	}

	if (typeof value !== 'object') {
		return
	}

	const payload = value as {
		values?: unknown
		value?: unknown
		min?: unknown
		max?: unknown
		bool?: unknown
	}

	if (payload.values !== undefined) {
		state.values.push(...extractCsvValues(payload.values))
	}
	if (payload.value !== undefined) {
		state.values.push(...extractCsvValues(payload.value))
	}
	if (payload.min !== undefined && payload.min !== null) {
		const min = getSingleQueryValue(payload.min)
		if (min === undefined) {
			throw new BadRequestException(
				'Поле attributes.min должно быть строкой, числом или boolean'
			)
		}
		state.min = min
	}
	if (payload.max !== undefined && payload.max !== null) {
		const max = getSingleQueryValue(payload.max)
		if (max === undefined) {
			throw new BadRequestException(
				'Поле attributes.max должно быть строкой, числом или boolean'
			)
		}
		state.max = max
	}
	if (payload.bool !== undefined && payload.bool !== null) {
		const bool = getSingleQueryValue(payload.bool)
		if (bool === undefined) {
			throw new BadRequestException(
				'Поле attributes.bool должно быть строкой, числом или boolean'
			)
		}
		state.bool = parseBooleanStrict(bool, 'attributes.bool')
	}
}
