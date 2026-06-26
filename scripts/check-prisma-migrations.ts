import 'dotenv/config'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'

type CheckOptions = {
	requireShadow: boolean
	skipShadow: boolean
}

const MIGRATIONS_DIR = resolve(process.cwd(), 'prisma', 'migrations')
const LOCK_FILE = join(MIGRATIONS_DIR, 'migration_lock.toml')
const SCHEMA_DIR = resolve(process.cwd(), 'prisma', 'schema')
const NPX_BIN = process.platform === 'win32' ? 'npx.cmd' : 'npx'

async function main() {
	const options = parseOptions(process.argv.slice(2))

	await checkMigrationStructure()
	await maybeRunShadowDiff(options)

	console.log('Prisma migrations check passed.')
}

async function checkMigrationStructure(): Promise<void> {
	if (!existsSync(MIGRATIONS_DIR)) {
		throw new Error('Missing prisma/migrations directory.')
	}

	if (!existsSync(LOCK_FILE)) {
		throw new Error('Missing prisma/migrations/migration_lock.toml.')
	}

	const lock = await readFile(LOCK_FILE, 'utf8')
	if (!lock.includes('provider = "postgresql"')) {
		throw new Error('Prisma migration lock must use provider = "postgresql".')
	}

	const entries = await readdir(MIGRATIONS_DIR)
	const migrationDirs = []
	for (const entry of entries) {
		const path = join(MIGRATIONS_DIR, entry)
		const info = await stat(path)
		if (info.isDirectory()) migrationDirs.push(entry)
	}

	if (migrationDirs.length === 0) {
		throw new Error('No Prisma migration directories found.')
	}

	for (const dir of migrationDirs.sort()) {
		const migrationPath = join(MIGRATIONS_DIR, dir, 'migration.sql')
		if (!existsSync(migrationPath)) {
			throw new Error(`Missing migration.sql in prisma/migrations/${dir}.`)
		}

		const sql = await readFile(migrationPath, 'utf8')
		if (sql.trim().length === 0) {
			throw new Error(`Empty migration.sql in prisma/migrations/${dir}.`)
		}
	}

	if (!existsSync(join(SCHEMA_DIR, 'schema.prisma'))) {
		throw new Error('Missing prisma/schema/schema.prisma.')
	}
}

async function maybeRunShadowDiff(options: CheckOptions): Promise<void> {
	if (options.skipShadow) {
		console.log('Shadow drift check skipped by --skip-shadow.')
		return
	}

	if (!process.env.SHADOW_DATABASE_URI) {
		if (options.requireShadow) {
			throw new Error(
				'SHADOW_DATABASE_URI is required for Prisma migration drift check.'
			)
		}

		console.log(
			'SHADOW_DATABASE_URI is not set; migration structure was checked, drift check was skipped.'
		)
		return
	}

	await runPrismaMigrateDiff()
}

function runPrismaMigrateDiff(): Promise<void> {
	const args = [
		'prisma',
		'migrate',
		'diff',
		'--from-migrations',
		'prisma/migrations',
		'--to-schema',
		'prisma/schema',
		'--exit-code'
	]

	console.log(`$ ${[NPX_BIN, ...args].join(' ')}`)

	return new Promise((resolvePromise, reject) => {
		const child = spawn(NPX_BIN, args, {
			cwd: process.cwd(),
			env: process.env,
			stdio: 'inherit',
			shell: false
		})

		child.on('error', reject)
		child.on('close', code => {
			if (code === 0) {
				resolvePromise()
				return
			}

			reject(
				new Error(`Prisma migrations drift check failed with exit code ${code}.`)
			)
		})
	})
}

function parseOptions(args: string[]): CheckOptions {
	return {
		requireShadow: args.includes('--require-shadow'),
		skipShadow: args.includes('--skip-shadow')
	}
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : error)
	process.exitCode = 1
})
