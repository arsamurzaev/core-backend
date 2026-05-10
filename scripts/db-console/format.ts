/* eslint-disable @typescript-eslint/no-base-to-string */
import Table from 'cli-table3'

import type { FieldMeta, ModelMeta } from './types.js'

export const colors = {
	bold: (value: string) => `\x1b[1m${value}\x1b[0m`,
	dim: (value: string) => `\x1b[2m${value}\x1b[0m`,
	green: (value: string) => `\x1b[32m${value}\x1b[0m`,
	yellow: (value: string) => `\x1b[33m${value}\x1b[0m`,
	red: (value: string) => `\x1b[31m${value}\x1b[0m`,
	cyan: (value: string) => `\x1b[36m${value}\x1b[0m`
}

export function printHeader(mode: string, dbLabel: string) {
	console.log(colors.cyan(colors.bold('DB Console V2')))
	console.log(colors.dim(`mode=${mode}; db=${dbLabel}`))
}

export function printJson(value: unknown) {
	console.log(JSON.stringify(value, jsonReplacer, 2))
}

export function printDiffRows(
	beforeRows: Record<string, unknown>[],
	afterRows: Record<string, unknown>[],
	keyField = 'id',
	maxRows = 10
) {
	const afterByKey = new Map(
		afterRows.map((row, index) => [String(row[keyField] ?? index), row])
	)
	const diffRows: Record<string, unknown>[] = []

	for (const [index, before] of beforeRows.slice(0, maxRows).entries()) {
		const key = String(before[keyField] ?? index)
		const after = afterByKey.get(key) ?? afterRows[index] ?? {}
		const changed = diffObjects(before, after)

		if (Object.keys(changed).length) {
			diffRows.push({
				row: key,
				...changed
			})
		}
	}

	if (!diffRows.length) {
		console.log(colors.dim('Diff пустой: scalar-поля в preview не изменились.'))
		return
	}

	table(diffRows, undefined, maxRows)
}

export function table(rows: unknown[], model?: ModelMeta, maxRows = 50) {
	if (!rows.length) {
		console.log(colors.yellow('Пусто'))
		return
	}

	const limited = rows.slice(0, maxRows)
	const columns = chooseColumns(limited, model)
	const result = new Table({
		head: ['#', ...columns],
		wordWrap: true,
		truncate: '...',
		colWidths: [5, ...columns.map(column => columnWidth(column))]
	})

	for (const [index, row] of limited.entries()) {
		const source = row as Record<string, unknown>
		result.push([
			index + 1,
			...columns.map(column => formatCell(column, source[column]))
		])
	}

	console.log(result.toString())

	if (rows.length > limited.length) {
		console.log(colors.dim(`Показано ${limited.length} из ${rows.length}`))
	}
}

export function printModelFields(
	model: ModelMeta,
	enumValues: Map<string, string[]>
) {
	const result = new Table({
		head: ['Field', 'Kind', 'Type', 'DB', 'Flags'],
		wordWrap: true
	})

	for (const field of model.fields) {
		result.push([
			field.name,
			field.kind,
			field.rawType ?? field.type,
			field.dbName ?? '',
			[
				field.isId ? '@id' : '',
				field.isUnique ? '@unique' : '',
				field.hasDefault ? 'default' : '',
				field.isUpdatedAt ? '@updatedAt' : ''
			]
				.filter(Boolean)
				.join(', ')
		])
	}

	console.log(result.toString())

	for (const field of model.fields.filter(field => field.kind === 'enum')) {
		const values = enumValues.get(field.type)
		if (values) console.log(colors.dim(`${field.type}: ${values.join(', ')}`))
	}
}

export function maskSecrets<T>(value: T): T {
	return deepMap(value, (key, item) => {
		if (isSensitiveKey(key)) return '[hidden]'
		if (typeof item === 'bigint') return item.toString()
		if (item instanceof Date) return item.toISOString()
		if (isDecimalLike(item)) return item.toString()
		return item
	}) as T
}

export function jsonReplacer(key: string, value: unknown) {
	if (isSensitiveKey(key)) return '[hidden]'
	if (typeof value === 'bigint') return value.toString()
	if (value instanceof Date) return value.toISOString()
	if (isDecimalLike(value)) return value.toString()
	return value
}

export function rowsToCsv(rows: Record<string, unknown>[]) {
	if (!rows.length) return ''

	const safeRows = rows.map(row => maskSecrets(row))

	const columns = Array.from(
		safeRows.reduce((set, row) => {
			Object.keys(row).forEach(key => set.add(key))
			return set
		}, new Set<string>())
	)

	return [
		columns.map(csvEscape).join(','),
		...safeRows.map(row =>
			columns.map(column => csvEscape(formatExportValue(row[column]))).join(',')
		)
	].join('\n')
}

export function diffObjects(
	before: Record<string, unknown>,
	after: Record<string, unknown>
) {
	const keys = new Set([...Object.keys(before), ...Object.keys(after)])
	const diff: Record<string, unknown> = {}

	for (const key of keys) {
		const left = JSON.stringify(before[key], jsonReplacer)
		const right = JSON.stringify(after[key], jsonReplacer)
		if (left !== right) {
			diff[key] =
				`${compact(left ?? 'undefined', 40)} -> ${compact(right ?? 'undefined', 40)}`
		}
	}

	return diff
}

export function fieldLabel(field: FieldMeta) {
	const bits = [
		field.kind,
		field.rawType ?? field.type,
		field.isId ? '@id' : '',
		field.isUnique ? '@unique' : '',
		field.hasDefault ? 'default' : '',
		field.dbName ? `db:${field.dbName}` : ''
	].filter(Boolean)

	return `${field.name} (${bits.join(', ')})`
}

export function compact(value: string, max = 100) {
	return value.length > max ? `${value.slice(0, max - 3)}...` : value
}

export function formatError(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}

export function isSensitiveKey(key: string) {
	const normalized = key.toLowerCase()
	return (
		normalized.includes('password') ||
		normalized.includes('secret') ||
		normalized.includes('token') ||
		normalized.includes('accesskey') ||
		normalized.includes('access_key')
	)
}

function chooseColumns(rows: unknown[], model?: ModelMeta) {
	const first = rows[0] as Record<string, unknown>
	const available = Object.keys(first)
	const priority = [
		'id',
		'name',
		'title',
		'login',
		'slug',
		'sku',
		'code',
		'status',
		'catalogId',
		'productId',
		'categoryId',
		'createdAt',
		'updatedAt',
		'deleteAt'
	]

	const modelFields =
		model?.fields
			.filter(field => field.kind !== 'object')
			.map(field => field.name)
			.filter(field => available.includes(field)) ?? available

	return [
		...priority.filter(column => available.includes(column)),
		...modelFields.filter(column => !priority.includes(column))
	].slice(0, 10)
}

function columnWidth(column: string) {
	if (column === 'id') return 38
	if (column.endsWith('Id')) return 38
	if (['createdAt', 'updatedAt', 'deleteAt'].includes(column)) return 26
	return 22
}

function formatCell(key: string, value: unknown) {
	if (isSensitiveKey(key)) return '[hidden]'
	if (value === null) return 'null'
	if (value === undefined) return ''
	if (value instanceof Date) return value.toISOString()
	if (typeof value === 'bigint') return value.toString()
	if (typeof value === 'object') {
		if (Array.isArray(value)) return `[${value.length}]`
		if (isDecimalLike(value)) return value.toString()
		return compact(JSON.stringify(value, jsonReplacer), 80)
	}
	return compact(String(value), 80)
}

function formatExportValue(value: unknown) {
	if (value === null || value === undefined) return ''
	if (typeof value === 'object') return JSON.stringify(value, jsonReplacer)
	return String(value)
}

function csvEscape(value: string) {
	if (!/[",\n\r]/.test(value)) return value
	return `"${value.replaceAll('"', '""')}"`
}

function isDecimalLike(value: unknown): value is { toString(): string } {
	return (
		typeof value === 'object' &&
		value !== null &&
		value.constructor?.name === 'Decimal'
	)
}

function deepMap(
	value: unknown,
	mapper: (key: string, item: unknown) => unknown
) {
	const walk = (key: string, item: unknown): unknown => {
		const mapped = mapper(key, item)
		if (mapped !== item) return mapped

		if (Array.isArray(item)) {
			return item.map((child, index) => walk(String(index), child))
		}

		if (item && typeof item === 'object' && !(item instanceof Date)) {
			if (isDecimalLike(item)) return item.toString()
			return Object.fromEntries(
				Object.entries(item).map(([childKey, child]) => [
					childKey,
					walk(childKey, child)
				])
			)
		}

		return mapped
	}

	return walk('', value)
}
