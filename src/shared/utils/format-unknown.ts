import { inspect } from 'node:util'

export function formatUnknownValue(value: unknown): string {
	if (typeof value === 'string') return value
	if (typeof value === 'number' || typeof value === 'boolean') {
		return value.toString()
	}
	if (typeof value === 'bigint') return value.toString()
	if (typeof value === 'symbol') return value.toString()
	if (value === null) return 'null'
	if (value === undefined) return 'undefined'

	return inspect(value, { depth: 6, breakLength: Infinity, compact: true })
}
