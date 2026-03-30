import { Prisma } from '@generated/client'

export type PrismaSlowQuerySettings = {
	thresholdMs: number
	maxQueryLength: number
}

const DEFAULT_PRISMA_SLOW_QUERY_THRESHOLD_MS = 300
const DEFAULT_PRISMA_SLOW_QUERY_MAX_QUERY_LENGTH = 500

function parseNonNegativeInteger(
	value: string | undefined,
	fallback: number
): number {
	if (value === undefined) return fallback

	const parsed = Number.parseInt(value, 10)
	if (!Number.isFinite(parsed) || parsed < 0) {
		return fallback
	}

	return parsed
}

export function resolvePrismaSlowQuerySettings(
	env: NodeJS.ProcessEnv = process.env
): PrismaSlowQuerySettings {
	return {
		thresholdMs: parseNonNegativeInteger(
			env.PRISMA_SLOW_QUERY_THRESHOLD_MS,
			DEFAULT_PRISMA_SLOW_QUERY_THRESHOLD_MS
		),
		maxQueryLength: Math.max(
			40,
			parseNonNegativeInteger(
				env.PRISMA_SLOW_QUERY_LOG_MAX_QUERY_LENGTH,
				DEFAULT_PRISMA_SLOW_QUERY_MAX_QUERY_LENGTH
			)
		)
	}
}

export function buildPrismaLogDefinitions(
	settings: PrismaSlowQuerySettings
): Prisma.LogDefinition[] {
	if (settings.thresholdMs <= 0) return []

	return [{ emit: 'event', level: 'query' }]
}

export function normalizePrismaQueryText(
	query: string,
	maxQueryLength: number
): string {
	const compact = query.replace(/\s+/g, ' ').trim()

	if (compact.length <= maxQueryLength) {
		return compact
	}

	return `${compact.slice(0, Math.max(0, maxQueryLength - 3)).trimEnd()}...`
}
