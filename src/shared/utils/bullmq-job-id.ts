const JOB_ID_SEGMENT_SEPARATOR = '--'
const UNSAFE_JOB_ID_CHARS = /[^A-Za-z0-9_-]+/g
const DASHES = /-+/g

function sanitizeJobIdSegment(value: string): string {
	const sanitized = value
		.trim()
		.replace(UNSAFE_JOB_ID_CHARS, '-')
		.replace(DASHES, '-')
		.replace(/^-+|-+$/g, '')

	return sanitized || 'empty'
}

export function buildBullMqSafeJobId(
	...segments: Array<number | string>
): string {
	return segments
		.map(segment => sanitizeJobIdSegment(String(segment)))
		.join(JOB_ID_SEGMENT_SEPARATOR)
}
