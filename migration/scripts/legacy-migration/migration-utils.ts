import {
	MigrationEntityKind,
	Prisma,
	PrismaClient
} from '../../../prisma/generated/client.js'

const RETRYABLE_CODES = new Set([
	'P2002', // unique constraint race that may resolve on retry
	'P2028', // interactive transaction expired
	'40001', // serialization_failure
	'40P01', // deadlock_detected
	'ECONNRESET',
	'ECONNREFUSED',
	'ETIMEDOUT'
])

const DEFAULT_INTERACTIVE_TRANSACTION_TIMEOUT_MS = readPositiveIntFromEnv(
	'LEGACY_MIGRATION_TX_TIMEOUT_MS',
	300_000
)
const DEFAULT_INTERACTIVE_TRANSACTION_MAX_WAIT_MS = readPositiveIntFromEnv(
	'LEGACY_MIGRATION_TX_MAX_WAIT_MS',
	30_000
)

export async function withRetry<T>(
	fn: () => Promise<T>,
	maxAttempts = 3,
	baseDelayMs = 150
): Promise<T> {
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await fn()
		} catch (err) {
			const code = String((err as Record<string, unknown>)?.code ?? '')
			if (!RETRYABLE_CODES.has(code) || attempt === maxAttempts) throw err
			await new Promise(resolve => setTimeout(resolve, baseDelayMs * attempt))
		}
	}

	throw new Error('withRetry: unreachable')
}

export async function runMigrationTransaction<T>(
	prisma: PrismaClient,
	fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
	return prisma.$transaction(fn, {
		timeout: DEFAULT_INTERACTIVE_TRANSACTION_TIMEOUT_MS,
		maxWait: DEFAULT_INTERACTIVE_TRANSACTION_MAX_WAIT_MS
	})
}

export async function loadAlreadyMigratedIds(
	prisma: PrismaClient,
	source: string,
	entity: MigrationEntityKind
): Promise<Set<string>> {
	const rows = await prisma.migrationEntityMap.findMany({
		where: { source, entity },
		select: { legacyId: true }
	})
	return new Set(rows.map(r => r.legacyId))
}

function readPositiveIntFromEnv(name: string, fallback: number): number {
	const raw = process.env[name]?.trim()
	if (!raw) return fallback

	const parsed = Number.parseInt(raw, 10)
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return fallback
	}

	return parsed
}
