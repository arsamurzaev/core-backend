/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { colors, jsonReplacer, printJson, table } from './format.js'
import { getDelegate, hasField, uniqueWhereFromRow } from './metadata.js'
import { askJson, choose, fuzzyChoose, pause, yesNo } from './prompt.js'
import {
	assertCanMutate,
	assertCanPhysicalDelete,
	backupRowsForWhere,
	confirmDanger,
	runAudited
} from './safety.js'
import { exportRows } from './storage.js'
import type { AppContext, FieldMeta, ModelMeta } from './types.js'

export async function runRowInspector(
	ctx: AppContext,
	models: ModelMeta[],
	model: ModelMeta,
	row: Record<string, unknown>
) {
	let current = row

	while (true) {
		console.log('')
		console.log(colors.cyan(colors.bold(`${model.name}: ${rowLabel(current)}`)))
		printScalarRows(model, current)

		const action = await choose('Row inspector', [
			{ name: 'JSON view', value: 'json' },
			{
				name: 'Explore relations',
				value: 'relations',
				disabled: model.fields.some(field => field.kind === 'object')
					? false
					: 'no relations'
			},
			{
				name: 'Update row',
				value: 'update',
				disabled: ctx.mode === 'readonly' ? 'readonly' : false
			},
			{
				name: 'Soft delete row',
				value: 'softDelete',
				disabled:
					ctx.mode === 'readonly'
						? 'readonly'
						: !hasField(model, 'deleteAt')
							? 'no deleteAt'
							: current.deleteAt
								? 'already deleted'
								: false
			},
			{
				name: 'Restore row',
				value: 'restore',
				disabled:
					ctx.mode === 'readonly'
						? 'readonly'
						: !hasField(model, 'deleteAt')
							? 'no deleteAt'
							: current.deleteAt
								? false
								: 'not deleted'
			},
			{
				name: 'Physical delete row',
				value: 'delete',
				disabled: ctx.mode !== 'danger' ? 'needs --danger' : false
			},
			{ name: 'Export row JSON', value: 'exportJson' },
			{ name: 'Export row CSV', value: 'exportCsv' },
			{ name: 'Back', value: 'back' }
		])

		if (action === 'back') return
		if (action === 'json') {
			printJson(current)
			await pause()
		}
		if (action === 'relations') {
			await exploreRelations(ctx, models, model, current)
		}
		if (action === 'update') {
			const updated = await updateCurrentRow(ctx, model, current)
			if (updated) current = updated
		}
		if (action === 'softDelete' || action === 'restore') {
			const updated = await toggleSoftDelete(ctx, model, current, action)
			if (updated) current = updated
		}
		if (action === 'delete') {
			const deleted = await deleteCurrentRow(ctx, model, current)
			if (deleted) return
		}
		if (action === 'exportJson' || action === 'exportCsv') {
			const filePath = await exportRows(
				ctx,
				model,
				[current],
				action === 'exportJson' ? 'json' : 'csv'
			)
			console.log(colors.green(`Export: ${filePath}`))
			await pause()
		}
	}
}

async function exploreRelations(
	ctx: AppContext,
	models: ModelMeta[],
	model: ModelMeta,
	row: Record<string, unknown>
) {
	const relation = await fuzzyChoose(
		'Relation',
		model.fields
			.filter(field => field.kind === 'object')
			.map(field => ({
				name: `${field.name} -> ${field.type}${field.isList ? '[]' : ''}`,
				value: field
			}))
	)
	const value = await loadRelation(ctx, model, row, relation)
	const targetModel = models.find(model => model.name === relation.type)

	if (value === null || value === undefined) {
		console.log(colors.yellow('Relation is empty'))
		await pause()
		return
	}

	if (Array.isArray(value)) {
		await inspectRelationList(ctx, models, targetModel, value)
		return
	}

	if (!targetModel) {
		printJson(value)
		await pause()
		return
	}

	await runRowInspector(
		ctx,
		models,
		targetModel,
		value as Record<string, unknown>
	)
}

async function inspectRelationList(
	ctx: AppContext,
	models: ModelMeta[],
	targetModel: ModelMeta | undefined,
	rows: unknown[]
) {
	const records = rows as Record<string, unknown>[]
	table(records, targetModel, ctx.options.limit)

	const action = await choose('Relation rows', [
		{
			name: 'Open row',
			value: 'open',
			disabled: targetModel && records.length ? false : 'not available'
		},
		{ name: 'JSON view', value: 'json' },
		{
			name: 'Export JSON',
			value: 'exportJson',
			disabled: records.length ? false : 'empty'
		},
		{
			name: 'Export CSV',
			value: 'exportCsv',
			disabled: records.length ? false : 'empty'
		},
		{ name: 'Back', value: 'back' }
	])

	if (action === 'back') return
	if (action === 'json') {
		printJson(records)
		await pause()
		return
	}
	if (action === 'open' && targetModel) {
		const row = await chooseRow(records)
		await runRowInspector(ctx, models, targetModel, row)
		return
	}
	if ((action === 'exportJson' || action === 'exportCsv') && targetModel) {
		const filePath = await exportRows(
			ctx,
			targetModel,
			records,
			action === 'exportJson' ? 'json' : 'csv'
		)
		console.log(colors.green(`Export: ${filePath}`))
		await pause()
	}
}

async function loadRelation(
	ctx: AppContext,
	model: ModelMeta,
	row: Record<string, unknown>,
	relation: FieldMeta
) {
	const where = uniqueWhereFromRow(model, row)
	if (!where) throw new Error('Cannot build unique where for this row')

	const delegate = getDelegate(ctx.prisma, model)
	const loaded = await delegate.findUnique({
		where,
		include: {
			[relation.name]: relation.isList ? { take: ctx.options.limit } : true
		}
	})
	const record = loaded as Record<string, unknown> | null

	return record?.[relation.name]
}

async function updateCurrentRow(
	ctx: AppContext,
	model: ModelMeta,
	row: Record<string, unknown>
) {
	assertCanMutate(ctx, 'update')
	const delegate = getDelegate(ctx.prisma, model)
	const where = uniqueWhereFromRow(model, row)
	if (!where) throw new Error('Cannot build unique where for this row')

	const data = (await askJson('data JSON', {}, { required: true })) ?? {}
	const accepted = await yesNo('Apply update?', false)
	if (!accepted) return null

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
			action: 'inspector:update',
			model: model.name,
			where,
			data,
			affectedCount: 1,
			backupPath
		},
		async () => {
			const result = await delegate.update({ where, data })
			return result as Record<string, unknown>
		}
	)
	console.log(colors.green('Updated'))
	await pause()
	return updated
}

async function toggleSoftDelete(
	ctx: AppContext,
	model: ModelMeta,
	row: Record<string, unknown>,
	action: 'softDelete' | 'restore'
) {
	assertCanMutate(ctx, action)
	const delegate = getDelegate(ctx.prisma, model)
	const where = uniqueWhereFromRow(model, row)
	if (!where) throw new Error('Cannot build unique where for this row')

	const data = { deleteAt: action === 'softDelete' ? new Date() : null }
	const accepted = await yesNo(
		action === 'softDelete' ? 'Set deleteAt = now()?' : 'Set deleteAt = null?',
		false
	)
	if (!accepted) return null

	const { backupPath } = await backupRowsForWhere(
		ctx,
		model,
		delegate,
		action,
		where
	)
	const updated = await runAudited(
		ctx,
		{
			action: `inspector:${action}`,
			model: model.name,
			where,
			data,
			affectedCount: 1,
			backupPath
		},
		async () => {
			const result = await delegate.update({ where, data })
			return result as Record<string, unknown>
		}
	)
	console.log(colors.green('Done'))
	await pause()
	return updated
}

async function deleteCurrentRow(
	ctx: AppContext,
	model: ModelMeta,
	row: Record<string, unknown>
) {
	assertCanPhysicalDelete(ctx)
	const delegate = getDelegate(ctx.prisma, model)
	const where = uniqueWhereFromRow(model, row)
	if (!where) throw new Error('Cannot build unique where for this row')

	const accepted = await confirmDanger(
		`Permanently delete this ${model.name} row?`
	)
	if (!accepted) return false

	const { backupPath } = await backupRowsForWhere(
		ctx,
		model,
		delegate,
		'delete',
		where
	)
	await runAudited(
		ctx,
		{
			action: 'inspector:delete',
			model: model.name,
			where,
			affectedCount: 1,
			backupPath
		},
		async () => {
			await delegate.delete({ where })
		}
	)
	console.log(colors.green('Deleted'))
	await pause()
	return true
}

async function chooseRow(rows: Record<string, unknown>[]) {
	return await choose(
		'Row',
		rows.map((row, index) => ({
			name: `${index + 1}. ${rowLabel(row)}`,
			value: row
		}))
	)
}

function printScalarRows(model: ModelMeta, row: Record<string, unknown>) {
	const scalarRows = model.fields
		.filter(field => field.kind !== 'object' && row[field.name] !== undefined)
		.map(field => ({
			field: field.name,
			type: field.rawType ?? field.type,
			value: row[field.name]
		}))

	table(scalarRows, undefined, 100)
}

function rowLabel(row: Record<string, unknown>) {
	for (const key of ['name', 'title', 'login', 'slug', 'sku', 'code', 'id']) {
		const value = row[key]
		if (value === undefined || value === null) continue
		return labelValue(value)
	}

	return JSON.stringify(row).slice(0, 80)
}

function labelValue(value: unknown) {
	if (typeof value === 'string') return value
	if (typeof value === 'number' || typeof value === 'boolean')
		return String(value)
	if (typeof value === 'bigint') return value.toString()
	if (typeof value === 'symbol') return value.description ?? value.toString()
	if (typeof value === 'function') return '[function]'
	if (value instanceof Date) return value.toISOString()
	return JSON.stringify(value, jsonReplacer)
}
