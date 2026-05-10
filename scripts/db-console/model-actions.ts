/* eslint-disable @typescript-eslint/no-base-to-string, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import path from 'node:path'

import { colors, printJson, printModelFields, table } from './format.js'
import { runRowInspector } from './inspector.js'
import {
	getDelegate,
	hasField,
	scalarSelect,
	uniqueWhereFromRow,
	writeableScalarFields
} from './metadata.js'
import {
	askJson,
	askText,
	choose,
	fuzzyChoose,
	pause,
	yesNo
} from './prompt.js'
import {
	assertCanMutate,
	assertCanPhysicalDelete,
	backupRowsForWhere,
	confirmDanger,
	previewMassMutation,
	previewUpdateManyTransaction,
	runAudited
} from './safety.js'
import {
	exportRows,
	listBackups,
	loadRecipes,
	readBackup,
	saveRecipe
} from './storage.js'
import type {
	AppContext,
	ModelMeta,
	PrismaDelegate,
	SchemaMeta
} from './types.js'
import {
	askDataPayload,
	askUniqueWhere,
	buildOrderBy,
	buildWhere,
	chooseWhere
} from './where-builder.js'

const rawMethods = [
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

export async function chooseModel(models: ModelMeta[]) {
	return await fuzzyChoose(
		'Сущность',
		models.map(model => ({
			name: `${model.name}${model.dbName ? ` -> ${model.dbName}` : ''}`,
			value: model
		}))
	)
}

export async function runModelMenu(
	ctx: AppContext,
	model: ModelMeta,
	schemaMeta: SchemaMeta,
	models: ModelMeta[] = [model]
) {
	const delegate = getDelegate(ctx.prisma, model)

	while (true) {
		printModelSummary(model, schemaMeta)

		const action = await choose(`${model.name}: действие`, [
			{ name: 'Список / выборка findMany', value: 'findMany' },
			{ name: 'Одна запись findFirst/findUnique', value: 'findOne' },
			{
				name: 'Создать create',
				value: 'create',
				disabled: ctx.mode === 'readonly' ? 'readonly' : false
			},
			{
				name: 'Обновить одну update',
				value: 'updateOne',
				disabled: ctx.mode === 'readonly' ? 'readonly' : false
			},
			{
				name: 'Обновить много updateMany',
				value: 'updateMany',
				disabled: ctx.mode === 'readonly' ? 'readonly' : false
			},
			{
				name: 'Мягко удалить deleteAt = now()',
				value: 'softDelete',
				disabled:
					ctx.mode === 'readonly'
						? 'readonly'
						: !hasField(model, 'deleteAt')
							? 'нет deleteAt'
							: false
			},
			{
				name: 'Восстановить deleteAt = null',
				value: 'restore',
				disabled:
					ctx.mode === 'readonly'
						? 'readonly'
						: !hasField(model, 'deleteAt')
							? 'нет deleteAt'
							: false
			},
			{
				name: 'Физически удалить одну delete',
				value: 'deleteOne',
				disabled: ctx.mode !== 'danger' ? 'нужен --danger' : false
			},
			{
				name: 'Физически удалить много deleteMany',
				value: 'deleteMany',
				disabled: ctx.mode !== 'danger' ? 'нужен --danger' : false
			},
			{ name: 'Посчитать count', value: 'count' },
			{ name: 'Агрегация aggregate/groupBy', value: 'aggregate' },
			{ name: 'Любая Prisma-операция JSON', value: 'raw' },
			{ name: 'Поля, связи, enum-значения', value: 'fields' },
			{ name: 'Назад', value: 'back' }
		])

		try {
			if (action === 'back') return
			if (action === 'findMany') await runFindMany(ctx, delegate, model, models)
			if (action === 'findOne') await runFindOne(ctx, delegate, model, models)
			if (action === 'create') await runCreate(ctx, delegate, model, schemaMeta)
			if (action === 'updateOne') {
				await runUpdateOne(ctx, delegate, model, schemaMeta)
			}
			if (action === 'updateMany') {
				await runUpdateMany(ctx, delegate, model, schemaMeta)
			}
			if (action === 'softDelete') {
				await runSoftDelete(ctx, delegate, model, 'softDelete')
			}
			if (action === 'restore') {
				await runSoftDelete(ctx, delegate, model, 'restore')
			}
			if (action === 'deleteOne') await runDeleteOne(ctx, delegate, model)
			if (action === 'deleteMany') await runDeleteMany(ctx, delegate, model)
			if (action === 'count') await runCount(delegate, model)
			if (action === 'aggregate') await runAggregate(delegate)
			if (action === 'raw') await runAnyPrismaOperation(ctx, delegate, model)
			if (action === 'fields') {
				printModelFields(model, schemaMeta.enums)
				await pause()
			}
		} catch (error) {
			console.log(
				colors.red(error instanceof Error ? error.message : String(error))
			)
			await pause()
		}
	}
}

export async function restoreFromBackup(ctx: AppContext, models: ModelMeta[]) {
	const backups = await listBackups(ctx)
	if (!backups.length) {
		console.log(colors.yellow('Backup-файлы не найдены'))
		await pause()
		return
	}

	const file = await choose(
		'Backup',
		backups.map(file => ({
			name: path.basename(file),
			value: file
		}))
	)
	const backup = await readBackup(file)
	const model = models.find(model => model.name === backup.meta.model)

	if (!model) throw new Error(`Модель ${backup.meta.model} больше не найдена`)
	assertCanMutate(ctx, 'restore backup')

	console.log(colors.bold('Backup summary'))
	printJson(backup.meta)
	table(backup.rows.slice(0, 10), model, 10)

	const accepted = await confirmDanger(
		`Восстановить ${backup.rows.length} строк из backup?`
	)
	if (!accepted) return

	const delegate = getDelegate(ctx.prisma, model)
	let updated = 0
	let created = 0
	let failed = 0

	await runAudited(
		ctx,
		{
			action: 'restoreBackup',
			model: model.name,
			affectedCount: backup.rows.length,
			backupPath: file
		},
		async () => {
			for (const row of backup.rows) {
				const where = uniqueWhereFromRow(model, row)
				const data = restoreData(model, row)

				try {
					if (where && (await delegate.findUnique({ where }))) {
						await delegate.update({ where, data })
						updated += 1
					} else {
						await delegate.create({ data: createData(model, row) })
						created += 1
					}
				} catch {
					failed += 1
				}
			}
		}
	)

	console.log(
		colors.green(
			`Готово: updated=${updated}, created=${created}, failed=${failed}`
		)
	)
	await pause()
}

async function runFindMany(
	ctx: AppContext,
	delegate: PrismaDelegate,
	model: ModelMeta,
	models: ModelMeta[]
) {
	let args = await buildFindManyArgs(ctx, model)
	let skip = Number(args.skip ?? 0)
	const take = Number(args.take ?? ctx.options.limit)

	while (true) {
		args = { ...args, skip, take }
		const rows = await delegate.findMany(args)
		console.log(
			colors.green(`Найдено: ${rows.length}; skip=${skip}; take=${take}`)
		)
		table(rows, model, ctx.options.limit)

		const action = await choose('Результат', [
			{
				name: 'Открыть строку',
				value: 'open',
				disabled: rows.length ? false : 'пусто'
			},
			{
				name: 'Обновить строку',
				value: 'update',
				disabled: ctx.mode === 'readonly' || !rows.length ? 'нельзя' : false
			},
			{
				name: 'Физически удалить строку',
				value: 'delete',
				disabled: ctx.mode !== 'danger' || !rows.length ? 'нужен --danger' : false
			},
			{
				name: 'Export JSON',
				value: 'exportJson',
				disabled: rows.length ? false : 'пусто'
			},
			{
				name: 'Export CSV',
				value: 'exportCsv',
				disabled: rows.length ? false : 'пусто'
			},
			{ name: 'Сохранить как recipe', value: 'saveRecipe' },
			{
				name: 'Следующая страница',
				value: 'next',
				disabled: rows.length < take ? 'конец' : false
			},
			{
				name: 'Предыдущая страница',
				value: 'prev',
				disabled: skip <= 0 ? 'начало' : false
			},
			{ name: 'Назад', value: 'back' }
		])

		if (action === 'back') return
		if (action === 'next') {
			skip += take
			continue
		}
		if (action === 'prev') {
			skip = Math.max(0, skip - take)
			continue
		}
		if (action === 'open') {
			const row = await chooseRow(rows)
			await runRowInspector(ctx, models, model, row as Record<string, unknown>)
		}
		if (action === 'update') {
			const row = await chooseRow(rows)
			await updateRow(ctx, delegate, model, row)
		}
		if (action === 'delete') {
			const row = await chooseRow(rows)
			await deleteRow(ctx, delegate, model, row)
		}
		if (action === 'exportJson' || action === 'exportCsv') {
			const file = await exportRows(
				ctx,
				model,
				rows as Record<string, unknown>[],
				action === 'exportJson' ? 'json' : 'csv'
			)
			console.log(colors.green(`Export: ${file}`))
			await pause()
		}
		if (action === 'saveRecipe') {
			const name = await askText('Recipe name', { required: true })
			await saveRecipe(ctx, { name, model: model.name, args })
			console.log(colors.green('Recipe сохранен'))
			await pause()
		}
	}
}

async function buildFindManyArgs(ctx: AppContext, model: ModelMeta) {
	const recipes = (await loadRecipes(ctx)).filter(
		recipe => recipe.model === model.name
	)
	const mode = await choose('Режим выборки', [
		...(recipes.length
			? [{ name: 'Загрузить recipe', value: 'recipe' as const }]
			: []),
		{ name: 'Быстрый конструктор where/order/take', value: 'builder' },
		{ name: 'JSON-аргументы частями', value: 'parts' },
		{ name: 'Полный Prisma args JSON', value: 'full' }
	])

	if (mode === 'recipe') {
		const recipe = await choose(
			'Recipe',
			recipes.map(recipe => ({
				name: recipe.name,
				value: recipe
			}))
		)
		return recipe.args
	}

	if (mode === 'full') {
		return (
			(await askJson<Record<string, unknown>>(
				'findMany args JSON',
				{},
				{ required: true }
			)) ?? {}
		)
	}

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
		const take = await askText('take', { default: String(ctx.options.limit) })
		const skip = await askText('skip', { default: '0' })

		return cleanArgs({
			where,
			orderBy,
			select,
			include,
			take: Number.parseInt(take, 10),
			skip: Number.parseInt(skip, 10)
		})
	}

	return cleanArgs({
		where: await buildWhere(model),
		orderBy: await buildOrderBy(model),
		include: await askJson('include JSON, Enter = без связей', undefined),
		take: Number.parseInt(
			await askText('take', { default: String(ctx.options.limit) }),
			10
		),
		skip: Number.parseInt(await askText('skip', { default: '0' }), 10)
	})
}

async function runFindOne(
	ctx: AppContext,
	delegate: PrismaDelegate,
	model: ModelMeta,
	models: ModelMeta[]
) {
	const mode = await choose('Как найти запись', [
		{ name: 'По unique/id через мастер', value: 'unique' },
		{ name: 'findUnique where JSON', value: 'findUniqueJson' },
		{ name: 'findFirst where JSON', value: 'findFirstJson' }
	])

	const row =
		mode === 'unique'
			? await delegate.findUnique({ where: await askUniqueWhere(model) })
			: mode === 'findUniqueJson'
				? await delegate.findUnique({
						where: (await askJson('where JSON', {}, { required: true })) ?? {}
					})
				: await delegate.findFirst({
						where: (await askJson('where JSON', {}, { required: true })) ?? {},
						include: await askJson('include JSON, Enter = без связей', undefined)
					})

	if (!row) console.log(colors.yellow('Запись не найдена'))
	else {
		await runRowInspector(ctx, models, model, row as Record<string, unknown>)
		return
	}

	await pause()
}

async function runCreate(
	ctx: AppContext,
	delegate: PrismaDelegate,
	model: ModelMeta,
	schemaMeta: SchemaMeta
) {
	assertCanMutate(ctx, 'create')
	const data = await askDataPayload(model, 'create', schemaMeta)
	const created = await runAudited(
		ctx,
		{ action: 'create', model: model.name, data, affectedCount: 1 },
		async () => await delegate.create({ data })
	)

	console.log(colors.green('Запись создана'))
	printJson(created)
	await pause()
}

async function runUpdateOne(
	ctx: AppContext,
	delegate: PrismaDelegate,
	model: ModelMeta,
	schemaMeta: SchemaMeta
) {
	assertCanMutate(ctx, 'update')
	const where = await askUniqueWhere(model)
	const current = await delegate.findUnique({
		where,
		select: scalarSelect(model)
	})

	if (!current) {
		console.log(colors.yellow('Запись не найдена'))
		await pause()
		return
	}

	table([current], model, 1)
	const data = await askDataPayload(model, 'update', schemaMeta)
	const accepted = await yesNo('Применить update?', false)
	if (!accepted) return

	const { backupPath } = await backupRowsForWhere(
		ctx,
		model,
		delegate,
		'update',
		where
	)
	const updated = await runAudited(
		ctx,
		{
			action: 'update',
			model: model.name,
			where,
			data,
			affectedCount: 1,
			backupPath
		},
		async () => await delegate.update({ where, data })
	)

	printJson(updated)
	await pause()
}

async function runUpdateMany(
	ctx: AppContext,
	delegate: PrismaDelegate,
	model: ModelMeta,
	schemaMeta: SchemaMeta
) {
	const where = await chooseWhere(model)
	const preview = await previewMassMutation(
		ctx,
		model,
		delegate,
		'update',
		where
	)
	if (!preview.confirmed) return

	const data = await askDataPayload(model, 'update', schemaMeta)
	await previewUpdateManyTransaction(ctx, model, delegate, where, data)
	const result = await runAudited(
		ctx,
		{
			action: 'updateMany',
			model: model.name,
			where,
			data,
			affectedCount: preview.count,
			backupPath: preview.backupPath
		},
		async () => await delegate.updateMany({ where, data })
	)

	console.log(colors.green(`Обновлено: ${result.count}`))
	await pause()
}

async function runSoftDelete(
	ctx: AppContext,
	delegate: PrismaDelegate,
	model: ModelMeta,
	mode: 'softDelete' | 'restore'
) {
	assertCanMutate(ctx, mode)
	const scope = await choose('Область действия', [
		{ name: 'Одна запись по unique/id', value: 'one' },
		{ name: 'Много записей по where', value: 'many' }
	])

	const data = { deleteAt: mode === 'softDelete' ? new Date() : null }

	if (scope === 'one') {
		const where = await askUniqueWhere(model)
		const current = await delegate.findUnique({
			where,
			select: scalarSelect(model)
		})
		if (!current) {
			console.log(colors.yellow('Запись не найдена'))
			await pause()
			return
		}

		table([current], model, 1)
		const accepted = await yesNo(
			mode === 'softDelete' ? 'Поставить deleteAt = now()?' : 'Очистить deleteAt?',
			false
		)
		if (!accepted) return

		const { backupPath } = await backupRowsForWhere(
			ctx,
			model,
			delegate,
			mode,
			where
		)
		const updated = await runAudited(
			ctx,
			{
				action: mode,
				model: model.name,
				where,
				data,
				affectedCount: 1,
				backupPath
			},
			async () => await delegate.update({ where, data })
		)
		printJson(updated)
		await pause()
		return
	}

	const where = await chooseWhere(model)
	const preview = await previewMassMutation(ctx, model, delegate, mode, where)
	if (!preview.confirmed) return

	await previewUpdateManyTransaction(ctx, model, delegate, where, data)

	const result = await runAudited(
		ctx,
		{
			action: mode,
			model: model.name,
			where,
			data,
			affectedCount: preview.count,
			backupPath: preview.backupPath
		},
		async () => await delegate.updateMany({ where, data })
	)
	console.log(colors.green(`Обновлено: ${result.count}`))
	await pause()
}

async function runDeleteOne(
	ctx: AppContext,
	delegate: PrismaDelegate,
	model: ModelMeta
) {
	assertCanPhysicalDelete(ctx)
	const where = await askUniqueWhere(model)
	const current = await delegate.findUnique({
		where,
		select: scalarSelect(model)
	})
	if (!current) {
		console.log(colors.yellow('Запись не найдена'))
		await pause()
		return
	}

	table([current], model, 1)
	const accepted = await confirmDanger(
		`Навсегда удалить запись из ${model.name}?`
	)
	if (!accepted) return

	const { backupPath } = await backupRowsForWhere(
		ctx,
		model,
		delegate,
		'delete',
		where
	)
	const deleted = await runAudited(
		ctx,
		{
			action: 'delete',
			model: model.name,
			where,
			affectedCount: 1,
			backupPath
		},
		async () => await delegate.delete({ where })
	)
	printJson(deleted)
	await pause()
}

async function runDeleteMany(
	ctx: AppContext,
	delegate: PrismaDelegate,
	model: ModelMeta
) {
	assertCanPhysicalDelete(ctx)
	const where = await chooseWhere(model)
	const preview = await previewMassMutation(
		ctx,
		model,
		delegate,
		'delete',
		where
	)
	if (!preview.confirmed) return

	const result = await runAudited(
		ctx,
		{
			action: 'deleteMany',
			model: model.name,
			where,
			affectedCount: preview.count,
			backupPath: preview.backupPath
		},
		async () => await delegate.deleteMany({ where })
	)
	console.log(colors.green(`Удалено: ${result.count}`))
	await pause()
}

async function runCount(delegate: PrismaDelegate, model: ModelMeta) {
	const where = await chooseWhere(model)
	const count = await delegate.count({ where })
	console.log(colors.green(`${model.name} count: ${count}`))
	await pause()
}

async function runAggregate(delegate: PrismaDelegate) {
	const mode = await choose('Агрегация', [
		{ name: 'aggregate args JSON', value: 'aggregate' },
		{ name: 'groupBy args JSON', value: 'groupBy' }
	])

	const args = (await askJson(`${mode} args JSON`, {}, { required: true })) ?? {}
	const result = await delegate[mode](args)
	printJson(result)
	await pause()
}

async function runAnyPrismaOperation(
	ctx: AppContext,
	delegate: PrismaDelegate,
	model: ModelMeta
) {
	const method = await choose(
		'Prisma method',
		rawMethods.map(method => ({
			name: method,
			value: method,
			disabled:
				ctx.mode === 'readonly' &&
				![
					'findMany',
					'findFirst',
					'findUnique',
					'count',
					'aggregate',
					'groupBy'
				].includes(method)
					? 'readonly'
					: ctx.mode !== 'danger' && ['delete', 'deleteMany'].includes(method)
						? 'нужен --danger'
						: false
		}))
	)

	const args =
		(await askJson(
			`${model.name}.${method} args JSON`,
			{},
			{ required: true }
		)) ?? {}
	const mutating = [
		'create',
		'createMany',
		'update',
		'updateMany',
		'upsert',
		'delete',
		'deleteMany'
	].includes(method)
	if (mutating) assertCanMutate(ctx, method)
	if (['delete', 'deleteMany'].includes(method)) assertCanPhysicalDelete(ctx)

	const result = mutating
		? await runAudited(
				ctx,
				{ action: `raw:${method}`, model: model.name, data: args },
				async () => await delegate[method](args)
			)
		: await delegate[method](args)

	printJson(result)
	await pause()
}

async function updateRow(
	ctx: AppContext,
	delegate: PrismaDelegate,
	model: ModelMeta,
	row: Record<string, unknown>
) {
	const where = uniqueWhereFromRow(model, row)
	if (!where) throw new Error('Не удалось собрать unique where из строки')

	const data = (await askJson('data JSON', {}, { required: true })) ?? {}
	const { backupPath } = await backupRowsForWhere(
		ctx,
		model,
		delegate,
		'update',
		where
	)
	const updated = await runAudited(
		ctx,
		{
			action: 'update',
			model: model.name,
			where,
			data,
			affectedCount: 1,
			backupPath
		},
		async () => await delegate.update({ where, data })
	)
	printJson(updated)
	await pause()
}

async function deleteRow(
	ctx: AppContext,
	delegate: PrismaDelegate,
	model: ModelMeta,
	row: Record<string, unknown>
) {
	assertCanPhysicalDelete(ctx)
	const where = uniqueWhereFromRow(model, row)
	if (!where) throw new Error('Не удалось собрать unique where из строки')

	const accepted = await confirmDanger(
		`Навсегда удалить запись из ${model.name}?`
	)
	if (!accepted) return

	const { backupPath } = await backupRowsForWhere(
		ctx,
		model,
		delegate,
		'delete',
		where
	)
	await runAudited(
		ctx,
		{ action: 'delete', model: model.name, where, affectedCount: 1, backupPath },
		async () => await delegate.delete({ where })
	)
	console.log(colors.green('Удалено'))
	await pause()
}

async function chooseRow(rows: any[]) {
	return await choose(
		'Строка',
		rows.map((row, index) => ({
			name: `${index + 1}. ${rowLabel(row)}`,
			value: row
		}))
	)
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
			`prisma.${model.delegate}` +
				(model.dbName ? `, table ${model.dbName}` : '') +
				`, scalar/enum: ${scalarCount}, relations: ${relationCount}`
		)
	)

	const enumFields = model.fields.filter(field => field.kind === 'enum')
	if (enumFields.length) {
		console.log(
			colors.dim(
				enumFields
					.map(field => {
						const values = schemaMeta.enums.get(field.type)
						return `${field.name}: ${field.type}${values ? ` [${values.join(', ')}]` : ''}`
					})
					.join('; ')
			)
		)
	}
}

function rowLabel(row: Record<string, unknown>) {
	return String(
		row.name ??
			row.title ??
			row.login ??
			row.slug ??
			row.sku ??
			row.code ??
			row.id ??
			JSON.stringify(row).slice(0, 80)
	)
}

function restoreData(model: ModelMeta, row: Record<string, unknown>) {
	const allowed = new Set(
		writeableScalarFields(model, 'update').map(field => field.name)
	)
	return Object.fromEntries(
		Object.entries(row).filter(([key]) => allowed.has(key) && key !== 'createdAt')
	)
}

function createData(model: ModelMeta, row: Record<string, unknown>) {
	const allowed = new Set(
		model.fields
			.filter(field => field.kind !== 'object' && !field.isUpdatedAt)
			.map(field => field.name)
	)
	return Object.fromEntries(
		Object.entries(row).filter(([key]) => allowed.has(key))
	)
}

function cleanArgs<T extends Record<string, unknown>>(args: T) {
	return Object.fromEntries(
		Object.entries(args).filter(([, value]) => value !== undefined)
	)
}
