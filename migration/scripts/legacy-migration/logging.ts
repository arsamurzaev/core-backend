type LegacyLogEntry = {
	timestamp?: string
	channel: 'phase' | 'media' | 'result'
	phase: string
	scope?: string
	label?: string
	message: string
	details?: Record<string, unknown>
}

export function logLegacyEvent(entry: LegacyLogEntry) {
	const payload = {
		timestamp: entry.timestamp ?? new Date().toISOString(),
		channel: entry.channel,
		phase: entry.phase,
		...(entry.scope ? { scope: entry.scope } : {}),
		...(entry.label ? { label: entry.label } : {}),
		message: entry.message,
		...(entry.details && Object.keys(entry.details).length > 0
			? { details: entry.details }
			: {})
	}

	console.log(JSON.stringify(payload))
}
