import { fieldLabel } from './format.js'
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import { getField, getUniqueChoices } from './metadata.js'
import { askJson, askText, choose, fuzzyChoose, yesNo } from './prompt.js'
import type { FieldMeta, ModelMeta, SchemaMeta } from './types.js'

export async function chooseWhere(model: ModelMeta) {
	const mode = await choose('Фильтр where', [
		{ name: 'Быстрый конструктор', value: 'builder' },
		{ name: 'where JSON', value: 'json' },
		{ name: 'Без фильтра {}', value: 'empty' }
	])

	if (mode === 'empty') return {}
	if (mode === 'json')
		return (await askJson('where JSON', {}, { required: true })) ?? {}
	return await buildWhere(model)
}

export async function buildWhere(model: ModelMeta) {
	const conditions: Record<string, unknown>[] = []

	while (true) {
		const add = await yesNo(
			conditions.length ? 'Добавить еще условие?' : 'Добавить условие?',
			conditions.length === 0
		)
		if (!add) break

		const source = await choose('Тип условия', [
			{ name: 'Scalar/enum поле', value: 'field' },
			{ name: 'Relation some/is JSON', value: 'relation' }
		])

		if (source === 'relation') {
			const relation = await fuzzyChoose(
				'Relation',
				model.fields
					.filter(field => field.kind === 'object')
					.map(field => ({
						name: `${field.name} (${field.type}${field.isList ? '[]' : ''})`,
						value: field
					}))
			)
			const relationWhere =
				(await askJson<Record<string, unknown>>(
					`${relation.name} relation filter JSON`,
					{},
					{ required: true }
				)) ?? {}
			conditions.push({ [relation.name]: relationWhere })
			continue
		}

		const field = await fuzzyChoose(
			'Поле',
			model.fields
				.filter(field => field.kind !== 'object')
				.map(field => ({ name: fieldLabel(field), value: field }))
		)
		conditions.push({ [field.name]: await buildFieldCondition(field) })
	}

	if (!conditions.length) return {}
	if (conditions.length === 1) return conditions[0]
	return { AND: conditions }
}

export async function buildOrderBy(model: ModelMeta) {
	const useOrder = await yesNo('Добавить сортировку?', false)
	if (!useOrder) return undefined

	const field = await fuzzyChoose(
		'Поле сортировки',
		model.fields
			.filter(field => field.kind !== 'object')
			.map(field => ({ name: fieldLabel(field), value: field }))
	)
	const direction = await choose('Направление', [
		{ name: 'asc', value: 'asc' },
		{ name: 'desc', value: 'desc' }
	])

	return { [field.name]: direction }
}

export async function askUniqueWhere(model: ModelMeta) {
	const choices = getUniqueChoices(model)

	if (!choices.length) {
		return (await askJson('where unique JSON', {}, { required: true })) ?? {}
	}

	const choice = await choose('Unique ключ', [
		...choices.map(choice => ({
			name: choice.label,
			value: choice
		})),
		{
			name: 'Ввести where JSON вручную',
			value: {
				label: 'json',
				fields: [],
				isCompound: false
			}
		}
	])

	if (choice.label === 'json') {
		return (await askJson('where unique JSON', {}, { required: true })) ?? {}
	}

	const values: Record<string, unknown> = {}

	for (const fieldName of choice.fields) {
		const field = getField(model, fieldName)
		values[fieldName] = field
			? await askFieldValue(field, fieldName)
			: await askText(fieldName, { required: true })
	}

	if (!choice.isCompound) {
		return { [choice.fields[0]]: values[choice.fields[0]] }
	}

	return { [choice.fields.join('_')]: values }
}

export async function askDataPayload(
	model: ModelMeta,
	mode: 'create' | 'update',
	schemaMeta: SchemaMeta
) {
	const inputMode = await choose('Формат data', [
		{ name: 'JSON data вручную', value: 'json' },
		{ name: 'Мастер по scalar/enum полям', value: 'wizard' }
	])

	if (inputMode === 'json') {
		return (await askJson('data JSON', {}, { required: true })) ?? {}
	}

	const data: Record<string, unknown> = {}
	const fields = model.fields.filter(field => {
		if (field.kind === 'object') return false
		if (field.isUpdatedAt) return false
		if (mode === 'update' && field.isId) return false
		if (field.name === 'createdAt' || field.name === 'updatedAt') return false
		return true
	})

	for (const field of fields) {
		const requiredCreate =
			mode === 'create' && field.isRequired && !field.hasDefault
		const shouldAsk =
			requiredCreate || (await yesNo(`Заполнить ${field.name}?`, false))
		if (!shouldAsk) continue

		if (field.kind === 'enum') {
			const values = schemaMeta.enums.get(field.type)
			if (values?.length) {
				data[field.name] = await choose(field.name, [
					...values.map(value => ({ name: value, value })),
					{ name: 'Ввести вручную', value: '__manual__' }
				])
				if (data[field.name] !== '__manual__') continue
			}
		}

		data[field.name] = await askFieldValue(field, field.name, !requiredCreate)
	}

	if (!Object.keys(data).length) {
		throw new Error('data пустой. Нужно хотя бы одно поле.')
	}

	return data
}

export async function askFieldValue(
	field: FieldMeta,
	label = field.name,
	optional = false
) {
	const value = await askText(`${label} (${field.rawType ?? field.type})`, {
		required: !optional
	})

	if (!value && optional) return undefined
	return parsePrimitive(field, value)
}

async function buildFieldCondition(field: FieldMeta) {
	const nullableChoices = field.isRequired
		? []
		: [
				{ name: 'equals null', value: 'null' },
				{ name: 'not null', value: 'notNull' }
			]

	if (field.type === 'String' || field.kind === 'enum') {
		const op = await choose('Оператор', [
			{ name: 'equals', value: 'equals' },
			{ name: 'in', value: 'in' },
			{ name: 'not', value: 'not' },
			...(field.type === 'String'
				? [
						{ name: 'contains', value: 'contains' },
						{ name: 'startsWith', value: 'startsWith' },
						{ name: 'endsWith', value: 'endsWith' }
					]
				: []),
			...nullableChoices
		])

		if (op === 'null') return null
		if (op === 'notNull') return { not: null }
		if (op === 'in') return { in: await askList(field) }

		const value = await askFieldValue(field)
		return op === 'equals' ? value : { [op]: value }
	}

	if (['Int', 'Float', 'Decimal', 'BigInt'].includes(field.type)) {
		const op = await choose('Оператор', [
			{ name: 'equals', value: 'equals' },
			{ name: 'gt', value: 'gt' },
			{ name: 'gte', value: 'gte' },
			{ name: 'lt', value: 'lt' },
			{ name: 'lte', value: 'lte' },
			{ name: 'in', value: 'in' },
			...nullableChoices
		])

		if (op === 'null') return null
		if (op === 'notNull') return { not: null }
		if (op === 'in') return { in: await askList(field) }

		const value = await askFieldValue(field)
		return op === 'equals' ? value : { [op]: value }
	}

	if (field.type === 'Boolean') {
		const op = await choose('Значение', [
			{ name: 'true', value: 'true' },
			{ name: 'false', value: 'false' },
			...nullableChoices
		])

		if (op === 'null') return null
		if (op === 'notNull') return { not: null }
		return op === 'true'
	}

	if (field.type === 'DateTime') {
		const op = await choose('Оператор', [
			{ name: 'equals', value: 'equals' },
			{ name: 'gt', value: 'gt' },
			{ name: 'gte', value: 'gte' },
			{ name: 'lt', value: 'lt' },
			{ name: 'lte', value: 'lte' },
			{ name: 'between', value: 'between' },
			...nullableChoices
		])

		if (op === 'null') return null
		if (op === 'notNull') return { not: null }
		if (op === 'between') {
			return {
				gte: await askFieldValue(field, 'От'),
				lte: await askFieldValue(field, 'До')
			}
		}

		const value = await askFieldValue(field)
		return op === 'equals' ? value : { [op]: value }
	}

	return await askFieldValue(field)
}

async function askList(field: FieldMeta) {
	const raw = await askText('Значения через запятую', { required: true })
	return raw.split(',').map(item => parsePrimitive(field, item.trim()))
}

function parsePrimitive(field: FieldMeta, value: string) {
	const raw = value.trim()

	if (raw.toLowerCase() === 'null') {
		if (field.isRequired) throw new Error(`${field.name} не nullable`)
		return null
	}

	if (field.kind === 'enum') return raw
	if (field.type === 'String') return raw
	if (field.type === 'Int') return parseInteger(raw, field.name)
	if (field.type === 'BigInt') return BigInt(raw)
	if (field.type === 'Float') return parseNumber(raw, field.name)
	if (field.type === 'Decimal') return raw
	if (field.type === 'Boolean') return parseBoolean(raw, field.name)
	if (field.type === 'DateTime') return parseDate(raw, field.name)
	if (field.type === 'Json') return JSON.parse(raw)

	return raw
}

function parseInteger(value: string, label: string) {
	const parsed = Number.parseInt(value, 10)
	if (!Number.isFinite(parsed)) throw new Error(`${label}: нужно целое число`)
	return parsed
}

function parseNumber(value: string, label: string) {
	const parsed = Number(value)
	if (!Number.isFinite(parsed)) throw new Error(`${label}: нужно число`)
	return parsed
}

function parseBoolean(value: string, label: string) {
	const normalized = value.toLowerCase()
	if (['true', '1', 'yes', 'y', 'да'].includes(normalized)) return true
	if (['false', '0', 'no', 'n', 'нет'].includes(normalized)) return false
	throw new Error(`${label}: нужно true/false`)
}

function parseDate(value: string, label: string) {
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) {
		throw new Error(`${label}: не понял дату. Пример: 2026-05-10T12:00:00Z`)
	}
	return date
}
