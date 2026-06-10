import {
	buildPrismaLogDefinitions,
	normalizePrismaQueryText,
	resolvePrismaSlowQuerySettings
} from './prisma-observability'

describe('prisma-observability', () => {
	it('uses sane defaults for slow query logging', () => {
		expect(resolvePrismaSlowQuerySettings({})).toEqual({
			thresholdMs: 300,
			maxQueryLength: 500
		})
	})

	it('allows disabling slow query logging with zero threshold', () => {
		const settings = resolvePrismaSlowQuerySettings({
			PRISMA_SLOW_QUERY_THRESHOLD_MS: '0',
			PRISMA_SLOW_QUERY_LOG_MAX_QUERY_LENGTH: '120'
		})

		expect(settings).toEqual({
			thresholdMs: 0,
			maxQueryLength: 120
		})
		expect(buildPrismaLogDefinitions(settings)).toEqual([])
	})

	it('falls back to defaults for invalid values', () => {
		expect(
			resolvePrismaSlowQuerySettings({
				PRISMA_SLOW_QUERY_THRESHOLD_MS: '-10',
				PRISMA_SLOW_QUERY_LOG_MAX_QUERY_LENGTH: 'oops'
			})
		).toEqual({
			thresholdMs: 300,
			maxQueryLength: 500
		})
	})

	it('normalizes and truncates SQL query text', () => {
		expect(
			normalizePrismaQueryText(
				' SELECT   *  \n FROM   categories \n WHERE name = $1 ',
				24
			)
		).toBe('SELECT * FROM categor...')
	})
})
