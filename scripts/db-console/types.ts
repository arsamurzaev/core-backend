import type { PrismaClient } from '../../prisma/generated/client.js'

export type SafetyMode = 'readonly' | 'safe' | 'danger'

export type CliOptions = {
	model?: string
	readonly: boolean
	danger: boolean
	limit: number
	json: boolean
	commandArgs: string[]
}

export type AppContext = {
	prisma: PrismaClient
	options: CliOptions
	mode: SafetyMode
	paths: RuntimePaths
	dbLabel: string
}

export type RuntimePaths = {
	root: string
	backups: string
	exports: string
	audit: string
	recipes: string
}

export type FieldKind = 'scalar' | 'object' | 'enum' | 'unsupported'

export type RuntimeField = {
	name: string
	kind: FieldKind
	type: string
	dbName?: string
}

export type RuntimeModel = {
	dbName?: string | null
	fields: RuntimeField[]
}

export type ParsedField = {
	rawType: string
	baseType: string
	isList: boolean
	isRequired: boolean
	isId: boolean
	isUnique: boolean
	hasDefault: boolean
	isUpdatedAt: boolean
	defaultValue?: string
}

export type ParsedModel = {
	fields: Map<string, ParsedField>
	compoundIds: string[][]
	compoundUniques: string[][]
}

export type FieldMeta = RuntimeField &
	Partial<ParsedField> & {
		isSensitive: boolean
	}

export type ModelMeta = {
	name: string
	delegate: string
	dbName?: string | null
	fields: FieldMeta[]
	compoundIds: string[][]
	compoundUniques: string[][]
}

export type SchemaMeta = {
	models: Map<string, ParsedModel>
	enums: Map<string, string[]>
}

export type PrismaDelegate = {
	[key: string]: (args?: any) => Promise<any>
	findMany: (args?: any) => Promise<any[]>
	findFirst: (args?: any) => Promise<any>
	findUnique: (args?: any) => Promise<any>
	create: (args?: any) => Promise<any>
	update: (args?: any) => Promise<any>
	updateMany: (args?: any) => Promise<{ count: number }>
	delete: (args?: any) => Promise<any>
	deleteMany: (args?: any) => Promise<{ count: number }>
	count: (args?: any) => Promise<number>
}

export type UniqueWhereChoice = {
	label: string
	fields: string[]
	isCompound: boolean
}

export type Recipe = {
	name: string
	model: string
	args: Record<string, unknown>
	createdAt: string
	updatedAt: string
}

export type AuditRecord = {
	at: string
	db: string
	mode: SafetyMode
	action: string
	model?: string
	where?: unknown
	data?: unknown
	affectedCount?: number
	backupPath?: string
	success: boolean
	error?: string
}

export type BackupFile = {
	meta: {
		at: string
		db: string
		model: string
		action: string
		where?: unknown
		count: number
	}
	rows: Record<string, unknown>[]
}
