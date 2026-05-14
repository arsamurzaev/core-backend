import 'dotenv/config'

import { runCatalogDiagnostics } from './catalog-diagnostics.js'
import { dbLabel, parseCliOptions, resolveMode, runtimePaths } from './cli.js'
import { runCatalogCockpit, runProductCategoryTools } from './cockpit.js'
import { runCommandMode } from './command-mode.js'
import { runCustomScriptsMenu } from './custom-scripts.js'
import { colors, printHeader, printJson, table } from './format.js'
import { runHealthMenu } from './health.js'
import { buildModelMeta, readSchemaMeta } from './metadata.js'
import {
	chooseModel,
	restoreFromBackup,
	runModelMenu
} from './model-actions.js'
import { runCommandPalette } from './palette.js'
import { createPrismaClient, validateDatabaseEnv } from './prisma.js'
import { askText, choose, pause, printJsonHelp } from './prompt.js'
import { assertCanRawExecute, confirmDanger, runAudited } from './safety.js'
import { ensureRuntimeDirs } from './storage.js'
import type { AppContext } from './types.js'
import { runQueryWorkspace } from './workspace.js'

export async function runDbConsole(argv = process.argv) {
	const options = parseCliOptions(argv)
	validateDatabaseEnv()

	const prisma = createPrismaClient()
	const ctx: AppContext = {
		prisma,
		options,
		mode: resolveMode(options),
		paths: runtimePaths(),
		dbLabel: dbLabel() || 'unknown'
	}

	try {
		await prisma.$connect()
		await ensureRuntimeDirs(ctx)

		const schemaMeta = readSchemaMeta()
		const models = buildModelMeta(prisma, schemaMeta)

		if (!options.json) printHeader(ctx.mode, ctx.dbLabel)

		if (await runCommandMode(ctx, models)) {
			return
		}

		if (options.model) {
			const model = models.find(
				item =>
					item.name.toLowerCase() === options.model?.toLowerCase() ||
					item.delegate.toLowerCase() === options.model?.toLowerCase()
			)
			if (!model) throw new Error(`Модель "${options.model}" не найдена`)
			await runModelMenu(ctx, model, schemaMeta, models)
			return
		}

		await mainMenu(ctx, models, schemaMeta)
	} finally {
		await prisma.$disconnect()
	}
}

async function mainMenu(
	ctx: AppContext,
	models: ReturnType<typeof buildModelMeta>,
	schemaMeta: ReturnType<typeof readSchemaMeta>
) {
	while (true) {
		const action = await choose('Главное меню', [
			{ name: 'Command palette', value: 'palette' },
			{ name: 'Query workspace', value: 'workspace' },
			{ name: 'Выбрать сущность Prisma', value: 'model' },
			{ name: 'Catalog cockpit', value: 'catalog' },
			{ name: 'Catalog deep diagnostics', value: 'catalogDiagnostics' },
			{ name: 'Product/Category tools', value: 'productTools' },
			{ name: 'Scripts', value: 'scripts' },
			{ name: 'Health checks', value: 'health' },
			{ name: 'Restore from backup', value: 'restoreBackup' },
			{ name: 'SQL SELECT через $queryRawUnsafe', value: 'query' },
			{
				name: 'SQL execute через $executeRawUnsafe',
				value: 'execute',
				disabled: ctx.mode !== 'danger' ? 'нужен --danger' : false
			},
			{ name: 'Подсказки JSON/where', value: 'help' },
			{ name: 'Выход', value: 'exit' }
		])

		try {
			if (action === 'exit') return
			if (action === 'help') {
				printJsonHelp()
				await pause()
			}
			if (action === 'palette') {
				await runCommandPalette(ctx, models, schemaMeta)
			}
			if (action === 'workspace') await runQueryWorkspace(ctx, models)
			if (action === 'model') {
				await runModelMenu(ctx, await chooseModel(models), schemaMeta, models)
			}
			if (action === 'catalog') await runCatalogCockpit(ctx, models)
			if (action === 'catalogDiagnostics') {
				const query = await askText('Catalog slug/name/domain/id', {
					required: true
				})
				await runCatalogDiagnostics(ctx, { query })
				await pause()
			}
			if (action === 'productTools') await runProductCategoryTools(ctx, models)
			if (action === 'scripts') await runCustomScriptsMenu(ctx, models)
			if (action === 'health') await runHealthMenu(ctx, models)
			if (action === 'restoreBackup') await restoreFromBackup(ctx, models)
			if (action === 'query') await runSqlQuery(ctx)
			if (action === 'execute') await runSqlExecute(ctx)
		} catch (error) {
			console.log(
				colors.red(error instanceof Error ? error.message : String(error))
			)
			await pause()
		}
	}
}

async function runSqlQuery(ctx: AppContext) {
	console.log(
		colors.yellow(
			'SQL SELECT выполняется как есть. Не вставляй пользовательский ввод.'
		)
	)
	const sql = await askText('SQL', { required: true })
	const rows = await ctx.prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql)

	if (ctx.options.json) printJson(rows)
	else table(Array.isArray(rows) ? rows : [rows], undefined, ctx.options.limit)

	await pause()
}

async function runSqlExecute(ctx: AppContext) {
	assertCanRawExecute(ctx)
	console.log(colors.red('SQL execute меняет базу напрямую. Нужен --danger.'))
	const sql = await askText('SQL', { required: true })
	const accepted = await confirmDanger('Выполнить raw SQL execute?')
	if (!accepted) return

	const result = await runAudited(
		ctx,
		{ action: 'rawSqlExecute', data: { sql } },
		async () => await ctx.prisma.$executeRawUnsafe(sql)
	)
	console.log(colors.green(`Готово. Затронуто строк: ${result}`))
	await pause()
}
