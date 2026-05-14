import { formatUnknownValue } from '@/shared/utils'

const REDACTED = '[redacted]'
const SENSITIVE_KEY_PATTERN =
	/(token|access[_-]?token|refresh[_-]?token|authorization|password|secret|api[_-]?key|ciphertext|client[_-]?secret)/i
const HEADER_SECRET_PATTERN =
	/\b(authorization\s*[:=]\s*['"]?(?:bearer|basic)\s+)([^'",\s;}\]]+)/gi
const BEARER_SECRET_PATTERN = /\b((?:bearer|basic)\s+)([A-Za-z0-9._~+/=-]+)/gi
const QUERY_SECRET_PATTERN =
	/([?&](?:token|access_token|refresh_token|api_key|apikey|password|secret)=)([^&\s]+)/gi
const JSON_SECRET_PATTERN =
	/("(?:token|accessToken|access_token|refreshToken|refresh_token|authorization|password|secret|apiKey|api_key)"\s*:\s*")([^"]+)(")/gi
const KEY_VALUE_QUOTED_SECRET_PATTERN =
	/\b(token|accessToken|access_token|refreshToken|refresh_token|authorization|password|secret|apiKey|api_key|clientSecret|client_secret)\b(\s*[:=]\s*)(['"])(.*?)(\3)/gi
const KEY_VALUE_SECRET_PATTERN =
	/\b(token|accessToken|access_token|refreshToken|refresh_token|authorization|password|secret|apiKey|api_key|clientSecret|client_secret)\b(\s*[:=]\s*)([^\s,;}\]]+)/gi

export function redactProviderSecrets(
	value: string,
	knownSecrets: Array<string | null | undefined> = []
): string {
	let result = value
	for (const secret of knownSecrets) {
		if (!secret) continue
		result = result.split(secret).join(REDACTED)
	}

	return result
		.replace(JSON_SECRET_PATTERN, `$1${REDACTED}$3`)
		.replace(QUERY_SECRET_PATTERN, `$1${REDACTED}`)
		.replace(HEADER_SECRET_PATTERN, `$1${REDACTED}`)
		.replace(BEARER_SECRET_PATTERN, `$1${REDACTED}`)
		.replace(
			KEY_VALUE_QUOTED_SECRET_PATTERN,
			(_match, key: string, separator: string, quote: string) =>
				SENSITIVE_KEY_PATTERN.test(key)
					? `${key}${separator}${quote}${REDACTED}${quote}`
					: _match
		)
		.replace(
			KEY_VALUE_SECRET_PATTERN,
			(_match, key: string, separator: string) =>
				SENSITIVE_KEY_PATTERN.test(key) ? `${key}${separator}${REDACTED}` : _match
		)
}

export function redactProviderSecretsDeep(
	value: unknown,
	knownSecrets: Array<string | null | undefined> = [],
	depth = 6
): unknown {
	if (typeof value === 'string') {
		return redactProviderSecrets(value, knownSecrets)
	}
	if (
		value === null ||
		value === undefined ||
		typeof value !== 'object' ||
		depth <= 0
	) {
		return value
	}
	if (Array.isArray(value)) {
		return value.map(item =>
			redactProviderSecretsDeep(item, knownSecrets, depth - 1)
		)
	}

	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).map(([key, item]) => [
			key,
			SENSITIVE_KEY_PATTERN.test(key)
				? REDACTED
				: redactProviderSecretsDeep(item, knownSecrets, depth - 1)
		])
	)
}

export function renderSafeProviderErrorMessage(
	error: unknown,
	fallback = 'Unknown error',
	knownSecrets: Array<string | null | undefined> = []
): string {
	const message =
		error instanceof Error && error.message
			? error.message
			: error === null || error === undefined
				? fallback
				: formatUnknownValue(redactProviderSecretsDeep(error, knownSecrets))
	const safe = redactProviderSecrets(message, knownSecrets).trim()
	return safe || fallback
}

export function toSafeProviderError(
	error: unknown,
	knownSecrets: Array<string | null | undefined> = []
): Error {
	return new Error(
		renderSafeProviderErrorMessage(error, 'Unknown error', knownSecrets)
	)
}
