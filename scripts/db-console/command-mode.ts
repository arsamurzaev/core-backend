/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { runCatalogDiagnostics } from './catalog-diagnostics.js'
import { runMoySkladCatalogVisibilityCommand } from './custom-scripts.js'
import { colors, printJson, table } from './format.js'
import { getDelegate, scalarSelect } from './metadata.js'
import {
	assertCanMutate,
	backupRowsForWhere,
	previewUpdateManyTransaction,
	runAudited
} from './safety.js'
import { exportRows } from './storage.js'
import type { AppContext, ModelMeta } from './types.js'

type CommandTokens = {
	subject: string
	action: string
	options: Record<string, string | boolean>
}

const uuidRegex =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function runCommandMode(ctx: AppContext, models: ModelMeta[]) {
	if (!ctx.options.commandArgs.length) return false

	const command = parseCommandTokens(ctx.options.commandArgs)

	if (
		command.subject === 'catalog' &&
		['diagnostics', 'health'].includes(command.action)
	) {
		await runCatalogDiagnostics(ctx, catalogLookup(command.options), {
			json: Boolean(command.options.json),
			exportFormat: exportFormat(command.options)
		})
		return true
	}

	if (
		command.subject === 'catalog' &&
		['moysklad-visibility', 'moyskladVisibility'].includes(command.action)
	) {
		await runMoySkladCatalogVisibilityCommand(ctx, command.options)
		return true
	}

	if (command.subject === 'health') {
		await runCommandHealth(ctx, command.action)
		return true
	}

	const model = findModel(models, command.subject)
	await runModelCommand(ctx, model, command)
	return true
}

export function parseCommandTokens(args: string[]): CommandTokens {
	const [subject, action = 'find', ...rest] = args
	if (!subject) throw new Error('Command mode requires a subject')

	const options: Record<string, string | boolean> = {}
	for (let index = 0; index < rest.length; index += 1) {
		const token = rest[index]
		if (!token.startsWith('--')) continue

		const key = token.slice(2)
		const next = rest[index + 1]
		if (!next || next.startsWith('--')) {
			options[key] = true
		} else {
			options[key] = next
			index += 1
		}
	}

	return { subject, action, options }
}

async function runModelCommand(
	ctx: AppContext,
	model: ModelMeta,
	command: CommandTokens
) {
	const delegate = getDelegate(ctx.prisma, model)
	const where = await buildCommandWhere(ctx, model, command.options)

	if (['find', 'find-many', 'list'].includes(command.action)) {
		const include = jsonOption(command.options, 'include')
		const rows = await delegate.findMany({
			where,
			orderBy: jsonOption(command.options, 'order-by'),
			select: include
				? undefined
				: (jsonOption(command.options, 'select') ?? scalarSelect(model)),
			include,
			take: numberOption(command.options, 'take', ctx.options.limit),
			skip: numberOption(command.options, 'skip', 0)
		})
		outputRows(ctx, model, rows as Record<string, unknown>[])
		return
	}

	if (command.action === 'count') {
		const count = await delegate.count({ where })
		output(ctx, { model: model.name, count })
		return
	}

	if (command.action === 'export') {
		const include = jsonOption(command.options, 'include')
		const rows = await delegate.findMany({
			where,
			orderBy: jsonOption(command.options, 'order-by'),
			select: include
				? undefined
				: (jsonOption(command.options, 'select') ?? scalarSelect(model)),
			include,
			take: numberOption(command.options, 'take', ctx.options.limit),
			skip: numberOption(command.options, 'skip', 0)
		})
		const format = exportFormat(command.options) ?? 'json'
		const filePath = await exportRows(
			ctx,
			model,
			rows as Record<string, unknown>[],
			format
		)
		output(ctx, { model: model.name, count: rows.length, export: filePath })
		return
	}

	if (['update-many', 'updateMany'].includes(command.action)) {
		assertCanMutate(ctx, 'updateMany')
		const data = requiredJsonOption(command.options, 'data')
		await commandUpdateMany(ctx, model, delegate, where, data, command.options)
		return
	}

	if (['soft-delete', 'softDelete', 'restore'].includes(command.action)) {
		assertCanMutate(ctx, command.action)
		const data = {
			deleteAt: command.action === 'restore' ? null : new Date()
		}
		await commandUpdateMany(ctx, model, delegate, where, data, command.options)
		return
	}

	throw new Error(`Unknown command: ${command.subject} ${command.action}`)
}

async function commandUpdateMany(
	ctx: AppContext,
	model: ModelMeta,
	delegate: ReturnType<typeof getDelegate>,
	where: unknown,
	data: unknown,
	options: Record<string, string | boolean>
) {
	const count = await delegate.count({ where })
	console.log(colors.yellow(`Matched rows: ${count}`))
	const previewRows = await delegate.findMany({
		where,
		take: 10,
		select: scalarSelect(model)
	})
	table(previewRows, model, 10)
	await previewUpdateManyTransaction(ctx, model, delegate, where, data)

	if (!options.yes) {
		output(ctx, {
			model: model.name,
			matched: count,
			previewOnly: true,
			hint: 'Pass --yes to commit this command.'
		})
		return
	}

	const { backupPath } = await backupRowsForWhere(
		ctx,
		model,
		delegate,
		'commandUpdateMany',
		where
	)
	const result = await runAudited(
		ctx,
		{
			action: 'commandUpdateMany',
			model: model.name,
			where,
			data,
			affectedCount: count,
			backupPath
		},
		async () => await delegate.updateMany({ where, data })
	)
	output(ctx, { model: model.name, updated: result.count, backupPath })
}

async function buildCommandWhere(
	ctx: AppContext,
	model: ModelMeta,
	options: Record<string, string | boolean>
) {
	const parts: Record<string, unknown>[] = []
	const where = jsonOption(options, 'where')
	if (where && Object.keys(where).length) parts.push(where)

	if (typeof options.status === 'string') parts.push({ status: options.status })

	if (typeof options.catalog === 'string') {
		const catalog = await resolveCatalogId(ctx, options.catalog)
		if (model.name === 'Catalog') {
			parts.push({ id: catalog.id })
		} else if (model.fields.some(field => field.name === 'catalogId')) {
			parts.push({ catalogId: catalog.id })
		} else {
			throw new Error(`${model.name} does not have catalogId`)
		}
	}

	if (!parts.length) return {}
	if (parts.length === 1) return parts[0]
	return { AND: parts }
}

async function resolveCatalogId(ctx: AppContext, value: string) {
	const normalized = value.trim()
	const identity: Record<string, unknown>[] = uuidRegex.test(normalized)
		? [{ id: normalized }]
		: []
	const catalog = await (ctx.prisma as any).catalog.findFirst({
		where: {
			OR: [
				...identity,
				{ slug: normalized },
				{ domain: normalized },
				{ name: { equals: normalized, mode: 'insensitive' } }
			]
		},
		select: { id: true, slug: true, name: true }
	})
	if (!catalog) throw new Error(`Catalog not found: ${normalized}`)
	return catalog as { id: string; slug: string; name: string }
}

async function runCommandHealth(ctx: AppContext, action: string) {
	if (!['sizes', 'tables'].includes(action)) {
		throw new Error('Command health supports: sizes')
	}

	const rows = await ctx.prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
		select
			relname as table,
			pg_size_pretty(pg_total_relation_size(relid)) as total_size,
			pg_total_relation_size(relid)::bigint as bytes
		from pg_catalog.pg_statio_user_tables
		order by pg_total_relation_size(relid) desc
		limit 50
	`)
	outputRows(ctx, { name: 'TableSizes' }, rows)
}

function findModel(models: ModelMeta[], value: string) {
	const model = models.find(
		model =>
			model.name.toLowerCase() === value.toLowerCase() ||
			model.delegate.toLowerCase() === value.toLowerCase()
	)
	if (!model) throw new Error(`Model not found: ${value}`)
	return model
}

function outputRows(
	ctx: AppContext,
	model: ModelMeta | { name: string },
	rows: Record<string, unknown>[]
) {
	if (ctx.options.json) printJson(rows)
	else table(rows, 'fields' in model ? model : undefined, ctx.options.limit)
}

function output(ctx: AppContext, value: unknown) {
	if (ctx.options.json) printJson(value)
	else printJson(value)
}

function jsonOption(
	options: Record<string, string | boolean>,
	key: string
): Record<string, unknown> | undefined {
	const value = options[key]
	if (typeof value !== 'string') return undefined
	return JSON.parse(value) as Record<string, unknown>
}

function requiredJsonOption(
	options: Record<string, string | boolean>,
	key: string
) {
	const value = jsonOption(options, key)
	if (!value) throw new Error(`--${key} JSON is required`)
	return value
}

function numberOption(
	options: Record<string, string | boolean>,
	key: string,
	defaultValue: number
) {
	const value = options[key]
	if (typeof value !== 'string') return defaultValue
	const parsed = Number.parseInt(value, 10)
	if (!Number.isInteger(parsed)) throw new Error(`--${key} must be an integer`)
	return parsed
}

function exportFormat(options: Record<string, string | boolean>) {
	if (options.csv) return 'csv'
	if (options.json) return 'json'
	if (options.format === 'csv' || options.format === 'json')
		return options.format
	return undefined
}

function catalogLookup(options: Record<string, string | boolean>) {
	return {
		id: typeof options.id === 'string' ? options.id : undefined,
		slug: typeof options.slug === 'string' ? options.slug : undefined,
		query: typeof options.catalog === 'string' ? options.catalog : undefined
	}
}
