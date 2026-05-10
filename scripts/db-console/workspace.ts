import { colors, jsonReplacer, printJson, table } from './format.js'
import { runRowInspector } from './inspector.js'
import { getDelegate, scalarSelect } from './metadata.js'
import { chooseModel } from './model-actions.js'
import { askJson, askText, choose, pause } from './prompt.js'
import { exportRows, loadRecipes, saveRecipe } from './storage.js'
import type { AppContext, ModelMeta, Recipe } from './types.js'
import { buildWhere } from './where-builder.js'

type QueryState = {
	model: ModelMeta
	where: Record<string, unknown>
	orderBy?: Record<string, unknown>
	select?: Record<string, unknown>
	include?: Record<string, unknown>
	take: number
	skip: number
	rows: Record<string, unknown>[]
}

export async function runQueryWorkspace(ctx: AppContext, models: ModelMeta[]) {
	const state: QueryState = {
		model: await chooseModel(models),
		where: {},
		take: ctx.options.limit,
		skip: 0,
		rows: []
	}

	while (true) {
		printWorkspaceSummary(state)
		const action = await choose('Query workspace', [
			{ name: 'Run preview', value: 'run' },
			{ name: 'Change model', value: 'model' },
			{ name: 'Build where', value: 'buildWhere' },
			{ name: 'Edit where JSON', value: 'whereJson' },
			{ name: 'Edit orderBy JSON', value: 'orderBy' },
			{ name: 'Edit select JSON', value: 'select' },
			{ name: 'Edit include JSON', value: 'include' },
			{ name: 'Set take/skip', value: 'paging' },
			{
				name: 'Open result row',
				value: 'open',
				disabled: state.rows.length ? false : 'run preview first'
			},
			{
				name: 'Export current rows',
				value: 'export',
				disabled: state.rows.length ? false : 'no rows'
			},
			{ name: 'Save as recipe', value: 'saveRecipe' },
			{ name: 'Load recipe', value: 'loadRecipe' },
			{ name: 'Reset query', value: 'reset' },
			{ name: 'Back', value: 'back' }
		])

		if (action === 'back') return
		if (action === 'run') await runPreview(ctx, state)
		if (action === 'model') {
			state.model = await chooseModel(models)
			resetQuery(state, ctx.options.limit)
		}
		if (action === 'buildWhere') {
			state.where = await buildWhere(state.model)
			state.skip = 0
		}
		if (action === 'whereJson') {
			state.where =
				(await askJson<Record<string, unknown>>('where JSON', state.where)) ?? {}
			state.skip = 0
		}
		if (action === 'orderBy') {
			state.orderBy =
				(await askJson<Record<string, unknown>>(
					'orderBy JSON, Enter keeps current',
					state.orderBy
				)) ?? undefined
		}
		if (action === 'select') {
			state.select =
				(await askJson<Record<string, unknown>>(
					'select JSON, Enter keeps current',
					state.select
				)) ?? undefined
			if (state.select) state.include = undefined
		}
		if (action === 'include') {
			state.include =
				(await askJson<Record<string, unknown>>(
					'include JSON, Enter keeps current',
					state.include
				)) ?? undefined
			if (state.include) state.select = undefined
		}
		if (action === 'paging') await editPaging(state, ctx.options.limit)
		if (action === 'open') {
			const row = await chooseRow(state.rows)
			await runRowInspector(ctx, models, state.model, row)
		}
		if (action === 'export') await exportCurrentRows(ctx, state)
		if (action === 'saveRecipe') await saveCurrentRecipe(ctx, state)
		if (action === 'loadRecipe') await loadRecipeIntoState(ctx, state)
		if (action === 'reset') resetQuery(state, ctx.options.limit)
	}
}

export function workspaceArgs(state: Omit<QueryState, 'rows'>) {
	return cleanArgs({
		where: state.where,
		orderBy: state.orderBy,
		select: state.include
			? undefined
			: (state.select ?? scalarSelect(state.model)),
		include: state.include,
		take: state.take,
		skip: state.skip
	})
}

async function runPreview(ctx: AppContext, state: QueryState) {
	const delegate = getDelegate(ctx.prisma, state.model)
	const args = workspaceArgs(state)
	state.rows = (await delegate.findMany(args)) as Record<string, unknown>[]

	console.log(
		colors.green(
			`Rows: ${state.rows.length}; skip=${state.skip}; take=${state.take}`
		)
	)
	if (ctx.options.json) printJson(state.rows)
	else table(state.rows, state.model, state.take)
	await pause()
}

async function editPaging(state: QueryState, defaultTake: number) {
	const take = await askText('take', {
		default: String(state.take || defaultTake)
	})
	const skip = await askText('skip', { default: String(state.skip) })
	const parsedTake = Number.parseInt(take, 10)
	const parsedSkip = Number.parseInt(skip, 10)

	if (!Number.isInteger(parsedTake) || parsedTake < 1) {
		throw new Error('take must be a positive integer')
	}
	if (!Number.isInteger(parsedSkip) || parsedSkip < 0) {
		throw new Error('skip must be a non-negative integer')
	}

	state.take = parsedTake
	state.skip = parsedSkip
}

async function exportCurrentRows(ctx: AppContext, state: QueryState) {
	const format = await choose('Export format', [
		{ name: 'JSON', value: 'json' as const },
		{ name: 'CSV', value: 'csv' as const }
	])
	const filePath = await exportRows(ctx, state.model, state.rows, format)
	console.log(colors.green(`Export: ${filePath}`))
	await pause()
}

async function saveCurrentRecipe(ctx: AppContext, state: QueryState) {
	const name = await askText('Recipe name', { required: true })
	await saveRecipe(ctx, {
		name,
		model: state.model.name,
		args: workspaceArgs(state)
	})
	console.log(colors.green('Recipe saved'))
	await pause()
}

async function loadRecipeIntoState(ctx: AppContext, state: QueryState) {
	const recipes = (await loadRecipes(ctx)).filter(
		recipe => recipe.model === state.model.name
	)
	if (!recipes.length) {
		console.log(colors.yellow(`No recipes for ${state.model.name}`))
		await pause()
		return
	}

	const recipe = await chooseRecipe(recipes)
	applyRecipe(state, recipe)
}

function applyRecipe(state: QueryState, recipe: Recipe) {
	state.where = objectArg(recipe.args.where) ?? {}
	state.orderBy = objectArg(recipe.args.orderBy)
	state.select = objectArg(recipe.args.select)
	state.include = objectArg(recipe.args.include)
	state.take = numberArg(recipe.args.take, state.take)
	state.skip = numberArg(recipe.args.skip, 0)
	state.rows = []
}

async function chooseRecipe(recipes: Recipe[]) {
	return await choose(
		'Recipe',
		recipes.map(recipe => ({
			name: `${recipe.name} (${recipe.updatedAt})`,
			value: recipe
		}))
	)
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

function resetQuery(state: QueryState, limit: number) {
	state.where = {}
	state.orderBy = undefined
	state.select = undefined
	state.include = undefined
	state.take = limit
	state.skip = 0
	state.rows = []
}

function printWorkspaceSummary(state: QueryState) {
	console.log('')
	console.log(colors.cyan(colors.bold(`Workspace: ${state.model.name}`)))
	console.log(
		colors.dim(
			`where=${JSON.stringify(state.where)}; take=${state.take}; skip=${state.skip}; rows=${state.rows.length}`
		)
	)
}

function objectArg(value: unknown) {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		return value as Record<string, unknown>
	}
	return undefined
}

function numberArg(value: unknown, defaultValue: number) {
	if (typeof value !== 'number') return defaultValue
	return Number.isInteger(value) ? value : defaultValue
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

function cleanArgs<T extends Record<string, unknown>>(args: T) {
	return Object.fromEntries(
		Object.entries(args).filter(([, value]) => value !== undefined)
	)
}
