/* eslint-disable @typescript-eslint/no-base-to-string, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { stdin as input, stdout as output } from 'node:process'
import { createInterface } from 'node:readline/promises'

import { PrismaClient } from '../prisma/generated/client.js'

type FieldKind = 'scalar' | 'object' | 'enum' | 'unsupported'

type RuntimeField = {
	name: string
	kind: FieldKind
	type: string
	dbName?: string
}

type RuntimeModel = {
	dbName?: string | null
	fields: RuntimeField[]
}

type ParsedField = {
	rawType: string
	baseType: string
	isList: boolean
	isRequired: boolean
	isId: boolean
	isUnique: boolean
	hasDefault: boolean
	isUpdatedAt: boolean
}

type ParsedModel = {
	fields: Map<string, ParsedField>
	compoundIds: string[][]
	compoundUniques: string[][]
}

type FieldMeta = RuntimeField &
	Partial<ParsedField> & {
		isSensitive: boolean
	}

type ModelMeta = {
	name: string
	delegate: string
	dbName?: string | null
	fields: FieldMeta[]
	compoundIds: string[][]
	compoundUniques: string[][]
}

type SchemaMeta = {
	models: Map<string, ParsedModel>
	enums: Map<string, string[]>
}

type MenuChoice<T> = {
	label: string
	value: T
	hint?: string
	disabled?: boolean
}

type UniqueWhereChoice = {
	label: string
	fields: string[]
	isCompound: boolean
}

const rl = createInterface({ input, output })

const colors = {
	bold: (value: string) => `\x1b[1m${value}\x1b[0m`,
	dim: (value: string) => `\x1b[2m${value}\x1b[0m`,
	green: (value: string) => `\x1b[32m${value}\x1b[0m`,
	yellow: (value: string) => `\x1b[33m${value}\x1b[0m`,
	red: (value: string) => `\x1b[31m${value}\x1b[0m`,
	cyan: (value: string) => `\x1b[36m${value}\x1b[0m`
}

const destructiveMethods = new Set(['delete', 'deleteMany', 'updateMany'])

const delegateMethods = [
	'findMany',
	'findFirst',
	'findUnique',
	'create',
	'createMany',
	'update',
	'updateMany',
	'upsert',
	'delete',
	'deleteMany',
	'count',
	'aggregate',
	'groupBy'
] as const

async function main() {
	if (process.argv.includes('--help') || process.argv.includes('-h')) {
		printUsage()
		return
	}

	validateDatabaseEnv()

	const prisma = createPrismaClient()

	try {
		await prisma.$connect()

		const schemaMeta = readSchemaMeta()
		const models = buildModelMeta(prisma, schemaMeta)
		const initialModel = readArgValue('--model')

		printHeader()

		if (initialModel) {
			const model = models.find(
				item =>
					item.name.toLowerCase() === initialModel.toLowerCase() ||
					item.delegate.toLowerCase() === initialModel.toLowerCase()
			)

			if (!model) {
				throw new Error(`Модель "${initialModel}" не найдена`)
			}

			await runModelMenu(prisma, model, schemaMeta)
			return
		}

		await runMainMenu(prisma, models, schemaMeta)
	} finally {
		rl.close()
		await prisma.$disconnect()
	}
}

async function runMainMenu(
	prisma: PrismaClient,
	models: ModelMeta[],
	schemaMeta: SchemaMeta
) {
	while (true) {
		const action = await askMenu('Главное меню', [
			{ label: 'Выбрать сущность Prisma', value: 'model' },
			{ label: 'SQL SELECT через $queryRawUnsafe', value: 'query' },
			{ label: 'SQL execute через $executeRawUnsafe', value: 'execute' },
			{ label: 'Показать подсказки JSON/where', value: 'help' },
			{ label: 'Выход', value: 'exit' }
		])

		if (action === 'exit') return
		if (action === 'help') {
			printJsonHelp()
			await pause()
			continue
		}
		if (action === 'query') {
			await runSqlQuery(prisma)
			continue
		}
		if (action === 'execute') {
			await runSqlExecute(prisma)
			continue
		}

		const model = await chooseModel(models)
		if (model) {
			await runModelMenu(prisma, model, schemaMeta)
		}
	}
}

async function runModelMenu(
	prisma: PrismaClient,
	model: ModelMeta,
	schemaMeta: SchemaMeta
) {
	const delegate = getDelegate(prisma, model)

	while (true) {
		printModelSummary(model, schemaMeta)

		const action = await askMenu(`${model.name}: действие`, [
			{ label: 'Список / выборка findMany', value: 'findMany' },
			{ label: 'Одна запись findFirst/findUnique', value: 'findOne' },
			{ label: 'Создать create', value: 'create' },
			{ label: 'Обновить одну update', value: 'updateOne' },
			{ label: 'Обновить много updateMany', value: 'updateMany' },
			{
				label: 'Мягко удалить deleteAt = now()',
				value: 'softDelete',
				disabled: !hasField(model, 'deleteAt')
			},
			{
				label: 'Восстановить deleteAt = null',
				value: 'restore',
				disabled: !hasField(model, 'deleteAt')
			},
			{ label: 'Удалить одну delete', value: 'deleteOne' },
			{ label: 'Удалить много deleteMany', value: 'deleteMany' },
			{ label: 'Посчитать count', value: 'count' },
			{ label: 'Агрегация aggregate/groupBy', value: 'aggregate' },
			{ label: 'Любая Prisma-операция JSON', value: 'raw' },
			{ label: 'Поля, связи, enum-значения', value: 'fields' },
			{ label: 'Назад', value: 'back' }
		])

		try {
			if (action === 'back') return
			if (action === 'findMany') await runFindMany(delegate, model)
			if (action === 'findOne') await runFindOne(delegate, model)
			if (action === 'create') await runCreate(delegate, model, schemaMeta)
			if (action === 'updateOne') {
				await runUpdateOne(delegate, model, schemaMeta)
			}
			if (action === 'updateMany') {
				await runUpdateMany(delegate, model, schemaMeta)
			}
			if (action === 'softDelete') {
				await runSoftDelete(delegate, model, 'delete')
			}
			if (action === 'restore') {
				await runSoftDelete(delegate, model, 'restore')
			}
			if (action === 'deleteOne') await runDeleteOne(delegate, model)
			if (action === 'deleteMany') await runDeleteMany(delegate, model)
			if (action === 'count') await runCount(delegate, model)
			if (action === 'aggregate') await runAggregate(delegate, model)
			if (action === 'raw') await runAnyPrismaOperation(delegate, model)
			if (action === 'fields') {
				printDetailedFields(model, schemaMeta)
				await pause()
			}
		} catch (error) {
			printError(error)
			await pause()
		}
	}
}

async function chooseModel(models: ModelMeta[]) {
	const search = (
		await ask(
			'Фильтр по названию модели или таблицы, Enter = все модели',
			undefined,
			true
		)
	).toLowerCase()

	const filtered = search
		? models.filter(
				model =>
					model.name.toLowerCase().includes(search) ||
					model.delegate.toLowerCase().includes(search) ||
					(model.dbName ?? '').toLowerCase().includes(search)
			)
		: models

	if (!filtered.length) {
		console.log(colors.yellow('Ничего не найдено'))
		await pause()
		return null
	}

	return await askMenu(
		'Сущности',
		filtered.map(model => ({
			label: model.name,
			value: model,
			hint: `${model.delegate}${model.dbName ? ` -> ${model.dbName}` : ''}`
		})),
		true
	)
}

async function runFindMany(delegate: any, model: ModelMeta) {
	const mode = await askMenu('Режим выборки', [
		{ label: 'Быстрый конструктор where/order/take', value: 'builder' },
		{ label: 'JSON-аргументы частями', value: 'parts' },
		{ label: 'Полный Prisma args JSON', value: 'full' },
		{ label: 'Назад', value: 'back' }
	])

	if (mode === 'back') return

	const args =
		mode === 'full'
			? await askJson('findMany args JSON', {}, false)
			: await buildFindManyArgs(model, mode === 'parts' ? 'parts' : 'builder')

	const rows = await delegate.findMany(args)
	console.log(colors.green(`Найдено: ${rows.length}`))
	printRows(rows, model)

	if (!rows.length) {
		await pause()
		return
	}

	while (true) {
		const next = await askMenu('Что сделать с результатом', [
			{ label: 'Открыть запись по номеру', value: 'view' },
			{ label: 'Обновить запись по номеру', value: 'update' },
			{ label: 'Удалить запись по номеру', value: 'delete' },
			{ label: 'Показать полный JSON всех строк', value: 'json' },
			{ label: 'Назад', value: 'back' }
		])

		if (next === 'back') return
		if (next === 'json') {
			printJson(rows)
			await pause()
			continue
		}

		const row = await askRow(rows)
		if (!row) continue

		if (next === 'view') {
			printJson(row)
			await pause()
		}

		if (next === 'update') {
			const where = uniqueWhereFromRow(model, row)
			if (!where) {
				console.log(
					colors.yellow(
						'Не смог собрать unique where из строки. Используй действие update с JSON where.'
					)
				)
				await pause()
				continue
			}

			const data = await askDataPayload(model, 'update')
			const updated = await delegate.update({ where, data })
			console.log(colors.green('Запись обновлена'))
			printJson(updated)
			await pause()
		}

		if (next === 'delete') {
			const where = uniqueWhereFromRow(model, row)
			if (!where) {
				console.log(
					colors.yellow(
						'Не смог собрать unique where из строки. Используй действие delete с JSON where.'
					)
				)
				await pause()
				continue
			}

			printJson(row)
			const confirmed = await confirmDanger(`Удалить эту запись из ${model.name}?`)
			if (!confirmed) continue

			const deleted = await delegate.delete({ where })
			console.log(colors.green('Запись удалена'))
			printJson(deleted)
			await pause()
		}
	}
}

async function buildFindManyArgs(model: ModelMeta, mode: 'builder' | 'parts') {
	if (mode === 'parts') {
		const where = await askJson('where JSON, Enter = без фильтра', undefined)
		const orderBy = await askJson(
			'orderBy JSON, Enter = без сортировки',
			undefined
		)
		const select = await askJson('select JSON, Enter = все поля', undefined)
		const include = select
			? undefined
			: await askJson('include JSON, Enter = без связей', undefined)
		const take = await askNumber('take', 20)
		const skip = await askNumber('skip', 0)

		return cleanArgs({ where, orderBy, select, include, take, skip })
	}

	const where = await buildWhere(model)
	const orderBy = await buildOrderBy(model)
	const take = await askNumber('take', 20)
	const skip = await askNumber('skip', 0)
	const include = await askJson('include JSON, Enter = без связей', undefined)

	return cleanArgs({ where, orderBy, include, take, skip })
}

async function runFindOne(delegate: any, model: ModelMeta) {
	const mode = await askMenu('Как найти запись', [
		{ label: 'По unique/id через мастер', value: 'unique' },
		{ label: 'findUnique where JSON', value: 'findUniqueJson' },
		{ label: 'findFirst where JSON', value: 'findFirstJson' },
		{ label: 'Назад', value: 'back' }
	])

	if (mode === 'back') return

	let row: unknown

	if (mode === 'unique') {
		const where = await askUniqueWhere(model)
		row = await delegate.findUnique({ where })
	} else if (mode === 'findUniqueJson') {
		const where = await askJson('where JSON', {}, false)
		row = await delegate.findUnique({ where })
	} else {
		const where = await askJson('where JSON', {}, false)
		const include = await askJson('include JSON, Enter = без связей', undefined)
		row = await delegate.findFirst(cleanArgs({ where, include }))
	}

	if (!row) {
		console.log(colors.yellow('Запись не найдена'))
		await pause()
		return
	}

	printJson(row)
	await pause()
}

async function runCreate(
	delegate: any,
	model: ModelMeta,
	schemaMeta: SchemaMeta
) {
	const data = await askDataPayload(model, 'create', schemaMeta)
	const include = await askJson('include JSON, Enter = без связей', undefined)
	const select = include
		? undefined
		: await askJson('select JSON, Enter = все поля', undefined)
	const created = await delegate.create(cleanArgs({ data, include, select }))

	console.log(colors.green('Запись создана'))
	printJson(created)
	await pause()
}

async function runUpdateOne(
	delegate: any,
	model: ModelMeta,
	schemaMeta: SchemaMeta
) {
	const where = await askUniqueWhere(model)
	const before = await delegate.findUnique({ where })

	if (!before) {
		console.log(colors.yellow('Запись не найдена'))
		await pause()
		return
	}

	console.log(colors.bold('Текущее значение:'))
	printJson(before)

	const data = await askDataPayload(model, 'update', schemaMeta)
	const confirmed = await askYesNo('Применить update?', false)
	if (!confirmed) return

	const updated = await delegate.update({ where, data })
	console.log(colors.green('Запись обновлена'))
	printJson(updated)
	await pause()
}

async function runUpdateMany(
	delegate: any,
	model: ModelMeta,
	schemaMeta: SchemaMeta
) {
	const where = await chooseWhere(model)
	const count = await delegate.count({ where })
	console.log(colors.yellow(`Под фильтр попадает записей: ${count}`))

	if (!count) {
		await pause()
		return
	}

	const data = await askDataPayload(model, 'update', schemaMeta)
	const confirmed = await confirmToken(
		`update ${count}`,
		`Чтобы обновить ${count} записей, введи: update ${count}`
	)
	if (!confirmed) return

	const result = await delegate.updateMany({ where, data })
	console.log(colors.green(`Обновлено: ${result.count}`))
	await pause()
}

async function runSoftDelete(
	delegate: any,
	model: ModelMeta,
	mode: 'delete' | 'restore'
) {
	const scope = await askMenu('Область действия', [
		{ label: 'Одна запись по unique/id', value: 'one' },
		{ label: 'Много записей по where', value: 'many' },
		{ label: 'Назад', value: 'back' }
	])

	if (scope === 'back') return

	const data = {
		deleteAt: mode === 'delete' ? new Date() : null
	}

	if (scope === 'one') {
		const where = await askUniqueWhere(model)
		const row = await delegate.findUnique({ where })

		if (!row) {
			console.log(colors.yellow('Запись не найдена'))
			await pause()
			return
		}

		printJson(row)
		const confirmed = await askYesNo(
			mode === 'delete' ? 'Поставить deleteAt = now()?' : 'Очистить deleteAt?',
			false
		)
		if (!confirmed) return

		const updated = await delegate.update({ where, data })
		printJson(updated)
		await pause()
		return
	}

	const where = await chooseWhere(model)
	const count = await delegate.count({ where })
	console.log(colors.yellow(`Под фильтр попадает записей: ${count}`))

	if (!count) {
		await pause()
		return
	}

	const token = mode === 'delete' ? `soft delete ${count}` : `restore ${count}`
	const confirmed = await confirmToken(
		token,
		`Чтобы продолжить, введи: ${token}`
	)
	if (!confirmed) return

	const result = await delegate.updateMany({ where, data })
	console.log(colors.green(`Обновлено: ${result.count}`))
	await pause()
}

async function runDeleteOne(delegate: any, model: ModelMeta) {
	const where = await askUniqueWhere(model)
	const row = await delegate.findUnique({ where })

	if (!row) {
		console.log(colors.yellow('Запись не найдена'))
		await pause()
		return
	}

	printJson(row)

	const confirmed = await confirmDanger(
		`Навсегда удалить запись из ${model.name}?`
	)
	if (!confirmed) return

	const deleted = await delegate.delete({ where })
	console.log(colors.green('Запись удалена'))
	printJson(deleted)
	await pause()
}

async function runDeleteMany(delegate: any, model: ModelMeta) {
	const where = await chooseWhere(model)
	const count = await delegate.count({ where })
	console.log(colors.red(`Под фильтр попадает записей: ${count}`))

	if (!count) {
		await pause()
		return
	}

	const confirmed = await confirmToken(
		`delete ${count}`,
		`Это физическое удаление. Чтобы удалить ${count} записей, введи: delete ${count}`
	)
	if (!confirmed) return

	const result = await delegate.deleteMany({ where })
	console.log(colors.green(`Удалено: ${result.count}`))
	await pause()
}

async function runCount(delegate: any, model: ModelMeta) {
	const where = await chooseWhere(model)
	const count = await delegate.count({ where })
	console.log(colors.green(`Count: ${count}`))
	await pause()
}

async function runAggregate(delegate: any, model: ModelMeta) {
	const mode = await askMenu('Агрегация', [
		{ label: 'aggregate args JSON', value: 'aggregate' },
		{ label: 'groupBy args JSON', value: 'groupBy' },
		{ label: 'Назад', value: 'back' }
	])

	if (mode === 'back') return

	printAggregateHelp(model)

	const args = await askJson(`${mode} args JSON`, {}, false)
	const result = await delegate[mode](args)
	printJson(result)
	await pause()
}

async function runAnyPrismaOperation(delegate: any, model: ModelMeta) {
	const method = await askMenu(
		'Prisma method',
		delegateMethods.map(method => ({
			label: method,
			value: method
		})),
		true
	)

	if (!method) return

	const args = await askJson(`${model.name}.${method} args JSON`, {}, false)

	if (destructiveMethods.has(method)) {
		const confirmed = await confirmDanger(
			`Выполнить ${model.name}.${method} с этими args?`
		)
		if (!confirmed) return
	}

	const result = await delegate[method](args)
	printJson(result)
	await pause()
}

async function runSqlQuery(prisma: PrismaClient) {
	console.log(
		colors.yellow(
			'SQL SELECT выполняется как есть. Не вставляй сюда пользовательский ввод.'
		)
	)

	const sql = await ask('SQL', undefined, false)
	if (!sql.trim()) return

	const rows = await prisma.$queryRawUnsafe(sql)
	printRows(Array.isArray(rows) ? rows : [rows])
	await pause()
}

async function runSqlExecute(prisma: PrismaClient) {
	console.log(
		colors.red(
			'SQL execute меняет базу напрямую. Используй только когда точно понимаешь запрос.'
		)
	)

	const sql = await ask('SQL', undefined, false)
	if (!sql.trim()) return

	const confirmed = await confirmDanger('Выполнить raw SQL execute?')
	if (!confirmed) return

	const result = await prisma.$executeRawUnsafe(sql)
	console.log(colors.green(`Готово. Затронуто строк: ${result}`))
	await pause()
}

async function chooseWhere(model: ModelMeta) {
	const mode = await askMenu('Фильтр where', [
		{ label: 'Быстрый конструктор', value: 'builder' },
		{ label: 'where JSON', value: 'json' },
		{ label: 'Без фильтра {}', value: 'empty' }
	])

	if (mode === 'empty') return {}
	if (mode === 'json') return await askJson('where JSON', {}, false)

	return await buildWhere(model)
}

async function buildWhere(model: ModelMeta) {
	const conditions: Record<string, unknown>[] = []
	const fields = model.fields.filter(field => field.kind !== 'object')

	while (true) {
		const field = await askMenu(
			'Добавить условие where',
			fields.map(field => ({
				label: field.name,
				value: field,
				hint: fieldDescription(field)
			})),
			true
		)

		if (!field) break

		const condition = await buildFieldCondition(field)
		conditions.push({ [field.name]: condition })
	}

	if (!conditions.length) return {}
	if (conditions.length === 1) return conditions[0]

	return { AND: conditions }
}

async function buildFieldCondition(field: FieldMeta) {
	const nullableChoices = field.isRequired
		? []
		: [
				{ label: 'equals null', value: 'null' },
				{ label: 'not null', value: 'notNull' }
			]

	const type = field.type

	if (type === 'String' || field.kind === 'enum') {
		const ops = [
			{ label: 'equals', value: 'equals' },
			{ label: 'in', value: 'in' },
			{ label: 'not', value: 'not' },
			...(type === 'String'
				? [
						{ label: 'contains', value: 'contains' },
						{ label: 'startsWith', value: 'startsWith' },
						{ label: 'endsWith', value: 'endsWith' }
					]
				: []),
			...nullableChoices
		]

		const op = await askMenu('Оператор', ops)
		if (op === 'null') return null
		if (op === 'notNull') return { not: null }

		if (op === 'in') {
			const raw = await ask('Значения через запятую')
			return { in: raw.split(',').map(item => parsePrimitive(field, item.trim())) }
		}

		const value = await askFieldValue(field)
		return op === 'equals' ? value : { [op]: value }
	}

	if (['Int', 'Float', 'Decimal', 'BigInt'].includes(type)) {
		const op = await askMenu('Оператор', [
			{ label: 'equals', value: 'equals' },
			{ label: 'gt', value: 'gt' },
			{ label: 'gte', value: 'gte' },
			{ label: 'lt', value: 'lt' },
			{ label: 'lte', value: 'lte' },
			{ label: 'in', value: 'in' },
			...nullableChoices
		])

		if (op === 'null') return null
		if (op === 'notNull') return { not: null }

		if (op === 'in') {
			const raw = await ask('Значения через запятую')
			return { in: raw.split(',').map(item => parsePrimitive(field, item.trim())) }
		}

		const value = await askFieldValue(field)
		return op === 'equals' ? value : { [op]: value }
	}

	if (type === 'Boolean') {
		const op = await askMenu('Значение', [
			{ label: 'true', value: 'true' },
			{ label: 'false', value: 'false' },
			...nullableChoices
		])

		if (op === 'null') return null
		if (op === 'notNull') return { not: null }

		return op === 'true'
	}

	if (type === 'DateTime') {
		const op = await askMenu('Оператор', [
			{ label: 'equals', value: 'equals' },
			{ label: 'после даты gt', value: 'gt' },
			{ label: 'после или равно gte', value: 'gte' },
			{ label: 'до даты lt', value: 'lt' },
			{ label: 'до или равно lte', value: 'lte' },
			{ label: 'между датами', value: 'between' },
			...nullableChoices
		])

		if (op === 'null') return null
		if (op === 'notNull') return { not: null }

		if (op === 'between') {
			const from = await askFieldValue(field, 'От')
			const to = await askFieldValue(field, 'До')
			return { gte: from, lte: to }
		}

		const value = await askFieldValue(field)
		return op === 'equals' ? value : { [op]: value }
	}

	const value = await askFieldValue(field)
	return value
}

async function buildOrderBy(model: ModelMeta) {
	const fields = model.fields.filter(field => field.kind !== 'object')
	const useOrder = await askYesNo('Добавить сортировку?', false)
	if (!useOrder) return undefined

	const field = await askMenu(
		'Поле сортировки',
		fields.map(field => ({
			label: field.name,
			value: field,
			hint: fieldDescription(field)
		}))
	)
	const direction = await askMenu('Направление', [
		{ label: 'asc', value: 'asc' },
		{ label: 'desc', value: 'desc' }
	])

	return { [field.name]: direction }
}

async function askUniqueWhere(model: ModelMeta) {
	const choices = getUniqueChoices(model)

	if (!choices.length) {
		return await askJson('where unique JSON', {}, false)
	}

	const choice = await askMenu(
		'Unique ключ',
		[
			...choices.map(choice => ({
				label: choice.label,
				value: choice
			})),
			{
				label: 'Ввести where JSON вручную',
				value: {
					label: 'json',
					fields: [],
					isCompound: false
				}
			}
		],
		true
	)

	if (!choice) return await askJson('where unique JSON', {}, false)
	if (choice.label === 'json')
		return await askJson('where unique JSON', {}, false)

	const values: Record<string, unknown> = {}

	for (const fieldName of choice.fields) {
		const field = getField(model, fieldName)
		if (!field) {
			values[fieldName] = await ask(fieldName)
			continue
		}
		values[fieldName] = await askFieldValue(field, fieldName)
	}

	if (!choice.isCompound) {
		return { [choice.fields[0]]: values[choice.fields[0]] }
	}

	return {
		[choice.fields.join('_')]: values
	}
}

async function askDataPayload(
	model: ModelMeta,
	mode: 'create' | 'update',
	schemaMeta?: SchemaMeta
) {
	const inputMode = await askMenu('Формат data', [
		{ label: 'JSON data вручную', value: 'json' },
		{ label: 'Мастер по scalar/enum полям', value: 'wizard' }
	])

	if (inputMode === 'json') {
		return await askJson('data JSON', {}, false)
	}

	const data: Record<string, unknown> = {}
	const fields = model.fields.filter(field => {
		if (field.kind === 'object') return false
		if (mode === 'update' && (field.isId || field.isUpdatedAt)) return false
		if (mode === 'create' && field.isUpdatedAt) return false
		if (field.name === 'createdAt' || field.name === 'updatedAt') return false
		return true
	})

	for (const field of fields) {
		const shouldAsk =
			mode === 'update'
				? await askYesNo(`Изменить ${field.name}?`, false)
				: !field.hasDefault && field.isRequired

		const optional = mode === 'update' || !shouldAsk

		if (schemaMeta && field.kind === 'enum') {
			printEnumValues(schemaMeta, field.type)
		}

		const value = await askFieldValue(field, field.name, optional)

		if (value !== undefined) {
			data[field.name] = value
		}
	}

	if (!Object.keys(data).length) {
		throw new Error('data пустой. В update/create нужно хотя бы одно поле.')
	}

	return data
}

async function askFieldValue(
	field: FieldMeta,
	label = field.name,
	optional = false
) {
	const suffix = fieldDescription(field)
	const value = await ask(
		`${label} ${colors.dim(`(${suffix})`)}`,
		undefined,
		optional
	)

	if (value === '' && optional) return undefined
	return parsePrimitive(field, value)
}

function parsePrimitive(field: FieldMeta, value: string) {
	const raw = value.trim()

	if (raw.toLowerCase() === 'null') {
		if (field.isRequired) {
			throw new Error(`${field.name} не nullable`)
		}
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
	if (field.type === 'Json') return parseJsonText(raw)

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

async function askRow(rows: unknown[]) {
	const raw = await ask('Номер строки')
	const index = Number.parseInt(raw, 10) - 1

	if (!Number.isInteger(index) || index < 0 || index >= rows.length) {
		console.log(colors.yellow('Нет строки с таким номером'))
		await pause()
		return null
	}

	return rows[index] as Record<string, unknown>
}

async function askJson<T = any>(
	label: string,
	defaultValue?: T,
	optional = true
): Promise<T | undefined> {
	while (true) {
		const value = await ask(label, undefined, optional)

		if (!value.trim()) {
			if (optional) return defaultValue
			console.log(colors.yellow('Нужно ввести JSON'))
			continue
		}

		if (value.trim() === '?') {
			printJsonHelp()
			continue
		}

		try {
			const source = readJsonInputSource(value.trim())
			return parseJsonText(source) as T
		} catch (error) {
			printError(error)
			console.log(colors.dim('Подсказка: введи ? для примеров JSON.'))
		}
	}
}

function readJsonInputSource(value: string) {
	if (!value.startsWith('@')) return value

	const filePath = path.resolve(process.cwd(), value.slice(1))
	if (!existsSync(filePath)) {
		throw new Error(`JSON-файл не найден: ${filePath}`)
	}

	return readFileSync(filePath, 'utf8')
}

function parseJsonText(value: string) {
	return JSON.parse(value, (_key, item) => {
		return item
	})
}

async function askMenu<T>(
	title: string,
	choices: MenuChoice<T>[],
	allowBack = false
): Promise<T | null> {
	const availableChoices = choices.filter(choice => !choice.disabled)

	while (true) {
		console.log('')
		console.log(colors.bold(title))

		availableChoices.forEach((choice, index) => {
			const hint = choice.hint ? colors.dim(`  ${choice.hint}`) : ''
			console.log(`${index + 1}. ${choice.label}${hint}`)
		})

		if (allowBack) console.log('0. Назад')

		const value = await ask('>', undefined, false)
		const normalized = value.trim().toLowerCase()

		if (allowBack && ['0', 'b', 'back', 'назад'].includes(normalized)) {
			return null
		}
		if (['q', 'quit', 'exit', 'выход'].includes(normalized)) {
			throw new Error('Выход')
		}

		const index = Number.parseInt(normalized, 10)
		if (
			Number.isInteger(index) &&
			index >= 1 &&
			index <= availableChoices.length
		) {
			return availableChoices[index - 1].value
		}

		console.log(colors.yellow('Выбери номер из списка'))
	}
}

async function ask(label: string, defaultValue?: string, optional = false) {
	const suffix = defaultValue ? colors.dim(` (${defaultValue})`) : ''
	const value = await rl.question(`${label}${suffix}: `)
	const trimmed = value.trim()

	if (!trimmed && defaultValue !== undefined) return defaultValue
	if (!trimmed && !optional) return ''

	return trimmed
}

async function askNumber(label: string, defaultValue: number) {
	while (true) {
		const raw = await ask(label, String(defaultValue), true)
		const value = Number.parseInt(raw, 10)

		if (Number.isInteger(value)) return value
		console.log(colors.yellow('Нужно целое число'))
	}
}

async function askYesNo(label: string, defaultValue: boolean) {
	const suffix = defaultValue ? '[Y/n]' : '[y/N]'
	const value = (await ask(`${label} ${suffix}`, undefined, true)).toLowerCase()

	if (!value) return defaultValue
	return ['y', 'yes', 'да', 'д'].includes(value)
}

async function confirmDanger(label: string) {
	console.log(colors.red(label))
	const answer = await ask('Введи yes для подтверждения', undefined, true)
	return answer.toLowerCase() === 'yes'
}

async function confirmToken(token: string, label: string) {
	console.log(colors.red(label))
	const answer = await ask('Подтверждение', undefined, true)
	return answer === token
}

async function pause() {
	await ask('Enter для продолжения', undefined, true)
}

function getDelegate(prisma: PrismaClient, model: ModelMeta) {
	const delegate = (prisma as any)[model.delegate]
	if (!delegate) throw new Error(`Delegate prisma.${model.delegate} не найден`)
	return delegate
}

function createPrismaClient() {
	const connectionString = process.env.DATABASE_URI ?? process.env.DATABASE_URL

	return new PrismaClient({
		adapter: new PrismaPg(
			connectionString
				? { connectionString }
				: {
						user: process.env.DATABASE_USER,
						password: process.env.DATABASE_PASSWORD,
						host: process.env.DATABASE_HOST,
						port: Number.parseInt(process.env.DATABASE_PORT || '5432', 10),
						database: process.env.DATABASE_NAME
					}
		)
	})
}

function validateDatabaseEnv() {
	if (process.env.DATABASE_URI || process.env.DATABASE_URL) return

	const missing = [
		'DATABASE_USER',
		'DATABASE_PASSWORD',
		'DATABASE_HOST',
		'DATABASE_NAME'
	].filter(key => !process.env[key])

	if (missing.length) {
		throw new Error(
			`Не хватает переменных базы: ${missing.join(', ')} или DATABASE_URI`
		)
	}
}

function buildModelMeta(prisma: PrismaClient, schemaMeta: SchemaMeta) {
	const runtimeModels = (prisma as any)._runtimeDataModel?.models as
		| Record<string, RuntimeModel>
		| undefined

	if (!runtimeModels) {
		throw new Error('Не удалось прочитать Prisma runtimeDataModel')
	}

	return Object.entries(runtimeModels)
		.map(([name, runtimeModel]) => {
			const parsedModel = schemaMeta.models.get(name)
			const fields = runtimeModel.fields.map(field => {
				const parsedField = parsedModel?.fields.get(field.name)

				return {
					...field,
					...parsedField,
					isSensitive: isSensitiveKey(field.name)
				}
			})

			return {
				name,
				delegate: modelToDelegate(name),
				dbName: runtimeModel.dbName,
				fields,
				compoundIds: parsedModel?.compoundIds ?? [],
				compoundUniques: parsedModel?.compoundUniques ?? []
			}
		})
		.sort((left, right) => left.name.localeCompare(right.name))
}

function readSchemaMeta(): SchemaMeta {
	const schemaDir = path.resolve(process.cwd(), 'prisma/schema')
	const models = new Map<string, ParsedModel>()
	const enums = new Map<string, string[]>()

	if (!existsSync(schemaDir)) return { models, enums }

	const schemaText = readdirSync(schemaDir)
		.filter(file => file.endsWith('.prisma'))
		.map(file => readFileSync(path.join(schemaDir, file), 'utf8'))
		.join('\n')

	for (const match of schemaText.matchAll(/model\s+(\w+)\s+\{([\s\S]*?)\n\}/g)) {
		models.set(match[1], parseModel(match[2]))
	}

	for (const match of schemaText.matchAll(/enum\s+(\w+)\s+\{([\s\S]*?)\n\}/g)) {
		enums.set(match[1], parseEnum(match[2]))
	}

	return { models, enums }
}

function parseModel(body: string): ParsedModel {
	const fields = new Map<string, ParsedField>()
	const compoundIds: string[][] = []
	const compoundUniques: string[][] = []

	for (const rawLine of body.split('\n')) {
		const line = rawLine.trim()
		if (!line || line.startsWith('//')) continue

		if (line.startsWith('@@id')) {
			const fields = parseCompoundFields(line)
			if (fields.length) compoundIds.push(fields)
			continue
		}

		if (line.startsWith('@@unique')) {
			const fields = parseCompoundFields(line)
			if (fields.length) compoundUniques.push(fields)
			continue
		}

		if (line.startsWith('@@') || line.startsWith('@')) continue

		const match = line.match(/^(\w+)\s+([A-Za-z_]\w*(?:\[\])?\??)\s*(.*)$/)
		if (!match) continue

		const [, name, rawType, attrs] = match
		const isList = rawType.endsWith('[]')
		const isRequired = !rawType.endsWith('?') && !isList
		const baseType = rawType.replace(/\?|\[\]/g, '')

		fields.set(name, {
			rawType,
			baseType,
			isList,
			isRequired,
			isId: attrs.includes('@id'),
			isUnique: attrs.includes('@unique'),
			hasDefault: attrs.includes('@default('),
			isUpdatedAt: attrs.includes('@updatedAt')
		})
	}

	return { fields, compoundIds, compoundUniques }
}

function parseEnum(body: string) {
	return body
		.split('\n')
		.map(line => line.trim())
		.filter(line => line && !line.startsWith('//') && !line.startsWith('@'))
		.map(line => line.split(/\s+/)[0])
}

function parseCompoundFields(line: string) {
	const match = line.match(/\[([^\]]+)\]/)
	if (!match) return []

	return match[1].split(',').map(field => field.trim())
}

function modelToDelegate(name: string) {
	return `${name[0].toLowerCase()}${name.slice(1)}`
}

function getUniqueChoices(model: ModelMeta): UniqueWhereChoice[] {
	const singles = model.fields
		.filter(field => field.isId || field.isUnique)
		.map(field => ({
			label: field.isId ? `${field.name} @id` : `${field.name} @unique`,
			fields: [field.name],
			isCompound: false
		}))

	const compoundIds = model.compoundIds.map(fields => ({
		label: `${fields.join(' + ')} @@id`,
		fields,
		isCompound: true
	}))

	const compoundUniques = model.compoundUniques.map(fields => ({
		label: `${fields.join(' + ')} @@unique`,
		fields,
		isCompound: true
	}))

	return [...singles, ...compoundIds, ...compoundUniques]
}

function uniqueWhereFromRow(model: ModelMeta, row: Record<string, unknown>) {
	const choices = getUniqueChoices(model)

	for (const choice of choices) {
		const hasValues = choice.fields.every(field => row[field] !== undefined)
		if (!hasValues) continue

		if (!choice.isCompound) {
			return { [choice.fields[0]]: row[choice.fields[0]] }
		}

		return {
			[choice.fields.join('_')]: Object.fromEntries(
				choice.fields.map(field => [field, row[field]])
			)
		}
	}

	return null
}

function cleanArgs<T extends Record<string, unknown>>(args: T) {
	return Object.fromEntries(
		Object.entries(args).filter(([, value]) => value !== undefined)
	)
}

function hasField(model: ModelMeta, fieldName: string) {
	return model.fields.some(field => field.name === fieldName)
}

function getField(model: ModelMeta, fieldName: string) {
	return model.fields.find(field => field.name === fieldName)
}

function fieldDescription(field: FieldMeta) {
	const bits = [
		field.kind,
		field.rawType ?? field.type,
		field.isId ? '@id' : '',
		field.isUnique ? '@unique' : '',
		field.hasDefault ? 'default' : '',
		field.dbName ? `db:${field.dbName}` : ''
	].filter(Boolean)

	return bits.join(', ')
}

function printHeader() {
	console.log(colors.cyan(colors.bold('DB Console')))
	console.log(
		colors.dim(
			'Универсальный терминальный доступ к Prisma-моделям. В любой JSON-подсказке можно ввести ?.'
		)
	)
}

function printUsage() {
	console.log(`bun run db:console

Опции:
  --model Product   открыть меню конкретной модели
  --help           показать эту справку

JSON-поля понимают обычный Prisma args:
  {"where":{"name":{"contains":"test"}},"take":10}
  {"data":{"name":"New name"}}
  @payload.json  прочитать JSON из файла`)
}

function printModelSummary(model: ModelMeta, schemaMeta: SchemaMeta) {
	const scalarCount = model.fields.filter(
		field => field.kind !== 'object'
	).length
	const relationCount = model.fields.filter(
		field => field.kind === 'object'
	).length

	console.log('')
	console.log(colors.cyan(colors.bold(model.name)))
	console.log(
		colors.dim(
			`delegate prisma.${model.delegate}` +
				(model.dbName ? `, table ${model.dbName}` : '') +
				`, scalar/enum: ${scalarCount}, relations: ${relationCount}`
		)
	)

	const enumFields = model.fields.filter(field => field.kind === 'enum')
	if (enumFields.length) {
		const enumText = enumFields
			.map(field => {
				const values = schemaMeta.enums.get(field.type)
				return `${field.name}: ${field.type}${values ? ` [${values.join(', ')}]` : ''}`
			})
			.join('; ')
		console.log(colors.dim(enumText))
	}
}

function printDetailedFields(model: ModelMeta, schemaMeta: SchemaMeta) {
	const rows = model.fields.map(field => ({
		field: field.name,
		kind: field.kind,
		type: field.rawType ?? field.type,
		db: field.dbName ?? '',
		flags: [
			field.isId ? '@id' : '',
			field.isUnique ? '@unique' : '',
			field.hasDefault ? 'default' : '',
			field.isUpdatedAt ? '@updatedAt' : ''
		]
			.filter(Boolean)
			.join(', ')
	}))

	console.table(rows)

	for (const field of model.fields.filter(field => field.kind === 'enum')) {
		printEnumValues(schemaMeta, field.type)
	}

	if (model.compoundIds.length || model.compoundUniques.length) {
		console.log(colors.bold('Compound keys'))
		for (const fields of model.compoundIds) {
			console.log(`@@id(${fields.join(', ')})`)
		}
		for (const fields of model.compoundUniques) {
			console.log(`@@unique(${fields.join(', ')})`)
		}
	}
}

function printEnumValues(schemaMeta: SchemaMeta, enumName: string) {
	const values = schemaMeta.enums.get(enumName)
	if (!values) return
	console.log(colors.dim(`${enumName}: ${values.join(', ')}`))
}

function printRows(rows: unknown[], model?: ModelMeta) {
	if (!rows.length) {
		console.log(colors.yellow('Пусто'))
		return
	}

	const columns = chooseTableColumns(rows, model)
	const tableRows = rows.map((row, index) => {
		const source = row as Record<string, unknown>
		const result: Record<string, unknown> = { '#': index + 1 }

		for (const column of columns) {
			result[column] = formatTableValue(column, source[column])
		}

		return result
	})

	console.table(tableRows)
}

function chooseTableColumns(rows: unknown[], model?: ModelMeta) {
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

function formatTableValue(key: string, value: unknown) {
	if (isSensitiveKey(key)) return '[hidden]'
	if (value === null) return 'null'
	if (value === undefined) return ''
	if (value instanceof Date) return value.toISOString()
	if (typeof value === 'bigint') return value.toString()
	if (typeof value === 'object') {
		if (Array.isArray(value)) return `[${value.length}]`
		if (isDecimalLike(value)) return value.toString()
		return compact(JSON.stringify(value, jsonReplacer))
	}
	return compact(String(value))
}

function compact(value: string, max = 90) {
	return value.length > max ? `${value.slice(0, max - 3)}...` : value
}

function printJson(value: unknown) {
	console.log(JSON.stringify(value, jsonReplacer, 2))
}

function jsonReplacer(key: string, value: unknown) {
	if (isSensitiveKey(key)) return '[hidden]'
	if (typeof value === 'bigint') return value.toString()
	if (value instanceof Date) return value.toISOString()
	if (isDecimalLike(value)) return value.toString()
	return value
}

function isDecimalLike(value: unknown): value is { toString(): string } {
	return (
		typeof value === 'object' &&
		value !== null &&
		value.constructor?.name === 'Decimal'
	)
}

function isSensitiveKey(key: string) {
	const normalized = key.toLowerCase()
	return (
		normalized.includes('password') ||
		normalized.includes('secret') ||
		normalized.includes('token') ||
		normalized.includes('accesskey') ||
		normalized.includes('access_key')
	)
}

function printJsonHelp() {
	console.log(colors.bold('Примеры JSON для Prisma'))
	console.log(`where:
  {"name":{"contains":"shirt","mode":"insensitive"}}
  {"AND":[{"catalogId":"uuid"},{"deleteAt":null}]}
  {"createdAt":{"gte":"2026-01-01T00:00:00Z"}}

findMany args:
  {"where":{"status":"ACTIVE"},"orderBy":{"createdAt":"desc"},"take":20,"skip":0}
  {"where":{"catalog":{"slug":"hm"}},"include":{"catalog":true}}

create/update data:
  {"name":"New name","deleteAt":null}
  {"catalog":{"connect":{"id":"uuid"}}}

Можно указать файл:
  @tmp/query.json`)
}

function printAggregateHelp(model: ModelMeta) {
	const numericFields = model.fields
		.filter(field => ['Int', 'Float', 'Decimal', 'BigInt'].includes(field.type))
		.map(field => field.name)

	console.log(colors.dim('aggregate пример: {"_count":true}'))
	if (numericFields.length) {
		console.log(
			colors.dim(
				`числовые поля: ${numericFields.join(', ')}; пример {"_sum":{"${numericFields[0]}":true}}`
			)
		)
	}
	console.log(
		colors.dim(
			'groupBy пример: {"by":["status"],"_count":{"_all":true},"orderBy":{"status":"asc"}}'
		)
	)
}

function printError(error: unknown) {
	if (error instanceof Error && error.message === 'Выход') {
		throw error
	}

	console.log(colors.red(error instanceof Error ? error.message : String(error)))
}

function readArgValue(name: string) {
	const index = process.argv.indexOf(name)
	if (index === -1) return undefined
	return process.argv[index + 1]
}

process.on('SIGINT', () => {
	rl.close()
	process.exit(0)
})

main().catch(error => {
	if (error instanceof Error && error.message === 'Выход') {
		process.exitCode = 0
		return
	}

	console.error(
		colors.red(error instanceof Error ? error.message : String(error))
	)
	process.exitCode = 1
})
