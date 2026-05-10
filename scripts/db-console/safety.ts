import { colors, printDiffRows, table } from './format.js'
import { getDelegate, scalarSelect, uniqueWhereFromRow } from './metadata.js'
import { askText, yesNo } from './prompt.js'
import { writeAudit, writeBackup } from './storage.js'
import type { AppContext, ModelMeta, PrismaDelegate } from './types.js'

export function assertCanMutate(ctx: AppContext, action: string) {
	if (ctx.mode === 'readonly') {
		throw new Error(`Readonly mode: действие ${action} запрещено`)
	}
}

export function assertCanPhysicalDelete(ctx: AppContext) {
	assertCanMutate(ctx, 'physical delete')
	if (ctx.mode !== 'danger') {
		throw new Error('Физическое удаление доступно только с --danger')
	}
}

export function assertCanRawExecute(ctx: AppContext) {
	if (ctx.mode !== 'danger') {
		throw new Error('Raw SQL execute доступен только с --danger')
	}
}

export async function backupRowsForWhere(
	ctx: AppContext,
	model: ModelMeta,
	delegate: PrismaDelegate,
	action: string,
	where: unknown
) {
	const rows = await delegate.findMany({
		where,
		select: scalarSelect(model)
	})

	const backupPath = await writeBackup(
		ctx,
		model,
		action,
		rows as Record<string, unknown>[],
		where
	)

	return { rows: rows as Record<string, unknown>[], backupPath }
}

export async function previewMassMutation(
	ctx: AppContext,
	model: ModelMeta,
	delegate: PrismaDelegate,
	action: string,
	where: unknown
) {
	assertCanMutate(ctx, action)

	const count = await delegate.count({ where })
	console.log(colors.yellow(`Под фильтр попадает записей: ${count}`))

	if (!count) return { confirmed: false, count, backupPath: undefined }

	const previewRows = await delegate.findMany({
		where,
		take: 10,
		select: scalarSelect(model)
	})

	table(previewRows, model, 10)

	const confirmation = `${action} ${count} ${model.name}`
	const typed = await askText(`Чтобы продолжить, введи "${confirmation}"`, {
		required: true
	})

	if (typed !== confirmation) {
		console.log(colors.yellow('Отменено'))
		return { confirmed: false, count, backupPath: undefined }
	}

	const { backupPath } = await backupRowsForWhere(
		ctx,
		model,
		delegate,
		action,
		where
	)

	return { confirmed: true, count, backupPath }
}

export async function previewUpdateManyTransaction(
	ctx: AppContext,
	model: ModelMeta,
	delegate: PrismaDelegate,
	where: unknown,
	data: unknown,
	options: { maxRows?: number } = {}
) {
	const maxRows = options.maxRows ?? 10
	const beforeRows = (await delegate.findMany({
		where,
		take: maxRows,
		select: scalarSelect(model)
	})) as Record<string, unknown>[]

	if (!beforeRows.length) {
		console.log(colors.yellow('Transaction preview: строк для diff нет'))
		return { beforeRows, afterRows: [] as Record<string, unknown>[] }
	}

	let afterRows: Record<string, unknown>[] = []
	const afterWhere = buildAfterWhere(model, beforeRows)
	const rollback = new Error('__DB_CONSOLE_ROLLBACK__')

	try {
		await ctx.prisma.$transaction(async tx => {
			const txDelegate = getDelegate(tx, model)
			await txDelegate.updateMany({ where, data })
			afterRows = (await txDelegate.findMany({
				where: afterWhere,
				take: maxRows,
				select: scalarSelect(model)
			})) as Record<string, unknown>[]
			throw rollback
		})
	} catch (error) {
		if (error !== rollback) throw error
	}

	console.log(colors.cyan('Transaction preview diff (rolled back):'))
	printDiffRows(
		beforeRows,
		afterRows,
		chooseKeyField(model, beforeRows),
		maxRows
	)
	return { beforeRows, afterRows }
}

export async function runAudited<T>(
	ctx: AppContext,
	record: {
		action: string
		model?: string
		where?: unknown
		data?: unknown
		affectedCount?: number
		backupPath?: string
	},
	callback: () => Promise<T>
) {
	try {
		const result = await callback()
		await writeAudit(ctx, { ...record, success: true })
		return result
	} catch (error) {
		await writeAudit(ctx, {
			...record,
			success: false,
			error: error instanceof Error ? error.message : String(error)
		})
		throw error
	}
}

export async function confirmDanger(message: string) {
	console.log(colors.red(message))
	const accepted = await yesNo('Продолжить?', false)
	return accepted
}

function buildAfterWhere(model: ModelMeta, rows: Record<string, unknown>[]) {
	if (rows.every(row => row.id !== undefined)) {
		return { id: { in: rows.map(row => row.id) } }
	}

	const clauses = rows
		.map(row => uniqueWhereFromRow(model, row))
		.filter(Boolean)
		.map(where => {
			const [key, value] = Object.entries(where as Record<string, unknown>)[0]
			if (typeof value === 'object' && value !== null && key.includes('_')) {
				return value
			}
			return where
		})

	return clauses.length ? { OR: clauses } : {}
}

function chooseKeyField(model: ModelMeta, rows: Record<string, unknown>[]) {
	const idField = model.fields.find(field => field.isId && rows[0]?.[field.name])
	return idField?.name ?? (rows[0]?.id ? 'id' : Object.keys(rows[0] ?? {})[0])
}
