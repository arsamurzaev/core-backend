import { Command } from 'commander'

import type { CliOptions, RuntimePaths, SafetyMode } from './types.js'

export function parseCliOptions(argv = process.argv): CliOptions {
	const program = new Command()

	program
		.name('db:console')
		.description('Safe interactive Prisma database console')
		.argument('[command...]', 'optional command mode arguments')
		.option('--model <name>', 'open a model menu directly')
		.option('--readonly', 'disable all mutations')
		.option('--danger', 'allow raw execute and physical deletes')
		.option('--limit <number>', 'default list limit', parseLimit, 50)
		.option('--json', 'machine-readable output for future command mode')
		.allowUnknownOption(true)
		.allowExcessArguments(true)
		.helpOption('-h, --help')
		.addHelpText(
			'after',
			`

Command mode examples:
  db:console product find --where '{"status":"ACTIVE"}'
  db:console product export --catalog hm --csv
  db:console product update-many --where '{"status":"DRAFT"}' --data '{"status":"ACTIVE"}'
  db:console product update-many --where '{"status":"DRAFT"}' --data '{"status":"ACTIVE"}' --yes
  db:console catalog diagnostics --slug hm --json
  db:console health sizes
`
		)

	program.parse(argv)
	const options = program.opts<{
		model?: string
		readonly?: boolean
		danger?: boolean
		limit?: number
		json?: boolean
	}>()

	return {
		model: options.model,
		readonly: Boolean(options.readonly),
		danger: Boolean(options.danger),
		limit: options.limit ?? 50,
		json: Boolean(options.json),
		commandArgs: program.args
	}
}

export function resolveMode(options: CliOptions): SafetyMode {
	if (options.readonly) return 'readonly'
	if (options.danger) return 'danger'
	return 'safe'
}

export function runtimePaths(): RuntimePaths {
	const root = 'runtime/db-console'

	return {
		root,
		backups: `${root}/backups`,
		exports: `${root}/exports`,
		audit: `${root}/audit.jsonl`,
		recipes: `${root}/recipes.json`
	}
}

export function dbLabel() {
	const host = process.env.DATABASE_HOST ?? connectionUrlHost()
	const database = process.env.DATABASE_NAME ?? connectionUrlDatabase()
	return [host, database].filter(Boolean).join('/')
}

function parseLimit(value: string) {
	const parsed = Number.parseInt(value, 10)
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error('--limit must be a positive integer')
	}
	return parsed
}

function connectionUrlHost() {
	const url = process.env.DATABASE_URI ?? process.env.DATABASE_URL
	if (!url) return undefined

	try {
		return new URL(url).host
	} catch {
		return undefined
	}
}

function connectionUrlDatabase() {
	const url = process.env.DATABASE_URI ?? process.env.DATABASE_URL
	if (!url) return undefined

	try {
		return new URL(url).pathname.replace(/^\//, '')
	} catch {
		return undefined
	}
}
