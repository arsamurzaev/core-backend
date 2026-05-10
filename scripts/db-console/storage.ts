/* eslint-disable @typescript-eslint/no-base-to-string */
import {
	appendFile,
	mkdir,
	readdir,
	readFile,
	writeFile
} from 'node:fs/promises'
import path from 'node:path'

import { jsonReplacer, maskSecrets, rowsToCsv } from './format.js'
import type {
	AppContext,
	AuditRecord,
	BackupFile,
	ModelMeta,
	Recipe
} from './types.js'

export async function ensureRuntimeDirs(ctx: AppContext) {
	await mkdir(ctx.paths.backups, { recursive: true })
	await mkdir(ctx.paths.exports, { recursive: true })
}

export async function writeAudit(
	ctx: AppContext,
	record: Omit<AuditRecord, 'at' | 'db' | 'mode'>
) {
	await ensureRuntimeDirs(ctx)
	const payload: AuditRecord = {
		at: new Date().toISOString(),
		db: ctx.dbLabel,
		mode: ctx.mode,
		...maskSecrets(record)
	}

	await appendFile(ctx.paths.audit, `${JSON.stringify(payload, jsonReplacer)}\n`)
}

export async function writeBackup(
	ctx: AppContext,
	model: ModelMeta,
	action: string,
	rows: Record<string, unknown>[],
	where?: unknown
) {
	await ensureRuntimeDirs(ctx)
	const fileName = `${timestamp()}_${model.name}_${action}.json`
	const filePath = path.join(ctx.paths.backups, fileName)
	const payload: BackupFile = {
		meta: {
			at: new Date().toISOString(),
			db: ctx.dbLabel,
			model: model.name,
			action,
			where,
			count: rows.length
		},
		rows: rows
	}

	await writeFile(filePath, JSON.stringify(payload, backupReplacer, 2))
	return filePath
}

export async function listBackups(ctx: AppContext) {
	await ensureRuntimeDirs(ctx)
	const files = await readdir(ctx.paths.backups)
	return files
		.filter(file => file.endsWith('.json'))
		.sort()
		.reverse()
		.map(file => path.join(ctx.paths.backups, file))
}

export async function readBackup(filePath: string): Promise<BackupFile> {
	return JSON.parse(await readFile(filePath, 'utf8')) as BackupFile
}

export async function exportRows(
	ctx: AppContext,
	model: ModelMeta | { name: string },
	rows: Record<string, unknown>[],
	format: 'json' | 'csv'
) {
	await ensureRuntimeDirs(ctx)
	const filePath = path.join(
		ctx.paths.exports,
		`${timestamp()}_${model.name}.${format}`
	)

	if (format === 'json') {
		await writeFile(filePath, JSON.stringify(maskSecrets(rows), jsonReplacer, 2))
	} else {
		await writeFile(filePath, rowsToCsv(rows))
	}

	return filePath
}

export async function loadRecipes(ctx: AppContext) {
	try {
		return JSON.parse(await readFile(ctx.paths.recipes, 'utf8')) as Recipe[]
	} catch {
		return []
	}
}

export async function saveRecipe(
	ctx: AppContext,
	recipe: Omit<Recipe, 'createdAt' | 'updatedAt'>
) {
	await ensureRuntimeDirs(ctx)
	const recipes = await loadRecipes(ctx)
	const now = new Date().toISOString()
	const existingIndex = recipes.findIndex(
		item => item.model === recipe.model && item.name === recipe.name
	)

	if (existingIndex >= 0) {
		recipes[existingIndex] = {
			...recipes[existingIndex],
			...recipe,
			updatedAt: now
		}
	} else {
		recipes.push({
			...recipe,
			createdAt: now,
			updatedAt: now
		})
	}

	await writeFile(ctx.paths.recipes, JSON.stringify(recipes, jsonReplacer, 2))
}

function timestamp() {
	return new Date().toISOString().replaceAll(':', '-').replace(/\..+$/, '')
}

function backupReplacer(_key: string, value: unknown) {
	if (typeof value === 'bigint') return value.toString()
	if (value instanceof Date) return value.toISOString()
	if (
		typeof value === 'object' &&
		value !== null &&
		value.constructor?.name === 'Decimal'
	) {
		return value.toString()
	}
	return value
}
