const MS_PER_DAY = 24 * 60 * 60 * 1000

function startOfLocalDay(date: Date) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function getInclusiveExpiryBoundary(expiresAt: Date) {
	const boundary = startOfLocalDay(expiresAt)
	boundary.setDate(boundary.getDate() + 1)
	return boundary
}

export function isInclusiveExpiryActive(
	expiresAt?: Date | null,
	at = new Date()
) {
	if (!expiresAt) return true
	return at < getInclusiveExpiryBoundary(expiresAt)
}

export function getInclusiveCalendarDaysUntilExpiry(
	expiresAt: Date,
	at = new Date()
) {
	return Math.ceil(
		(getInclusiveExpiryBoundary(expiresAt).getTime() -
			startOfLocalDay(at).getTime()) /
			MS_PER_DAY
	)
}
