/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { isSensitiveKey } from './format.js'
import type {
	FieldMeta,
	ModelMeta,
	ParsedField,
	ParsedModel,
	PrismaDelegate,
	RuntimeModel,
	SchemaMeta,
	UniqueWhereChoice
} from './types.js'

export function readSchemaMeta(): SchemaMeta {
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

export function buildModelMeta(prisma: unknown, schemaMeta: SchemaMeta) {
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

export function getDelegate(prisma: unknown, model: ModelMeta): PrismaDelegate {
	const delegate = (prisma as any)[model.delegate]
	if (!delegate) throw new Error(`Delegate prisma.${model.delegate} не найден`)
	return delegate as PrismaDelegate
}

export function getField(model: ModelMeta, fieldName: string) {
	return model.fields.find(field => field.name === fieldName)
}

export function hasField(model: ModelMeta, fieldName: string) {
	return model.fields.some(field => field.name === fieldName)
}

export function getUniqueChoices(model: ModelMeta): UniqueWhereChoice[] {
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

export function uniqueWhereFromRow(
	model: ModelMeta,
	row: Record<string, unknown>
) {
	for (const choice of getUniqueChoices(model)) {
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

export function scalarSelect(model: ModelMeta) {
	return Object.fromEntries(
		model.fields
			.filter(field => field.kind !== 'object')
			.map(field => [field.name, true])
	)
}

export function writeableScalarFields(
	model: ModelMeta,
	mode: 'create' | 'update'
) {
	return model.fields.filter(field => {
		if (field.kind === 'object') return false
		if (field.isUpdatedAt) return false
		if (mode === 'update' && field.isId) return false
		if (field.name === 'createdAt' || field.name === 'updatedAt') return false
		return true
	})
}

export function modelToDelegate(name: string) {
	return `${name[0].toLowerCase()}${name.slice(1)}`
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
		const defaultValue = attrs.match(/@default\(([^)]+)\)/)?.[1]

		fields.set(name, {
			rawType,
			baseType,
			isList,
			isRequired,
			isId: attrs.includes('@id'),
			isUnique: attrs.includes('@unique'),
			hasDefault: attrs.includes('@default('),
			isUpdatedAt: attrs.includes('@updatedAt'),
			defaultValue
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

export function fieldByName(
	model: ModelMeta,
	fieldName: string
): FieldMeta | null {
	return model.fields.find(field => field.name === fieldName) ?? null
}
