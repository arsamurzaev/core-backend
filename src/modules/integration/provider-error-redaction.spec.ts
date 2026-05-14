import {
	redactProviderSecrets,
	redactProviderSecretsDeep,
	renderSafeProviderErrorMessage,
	toSafeProviderError
} from './provider-error-redaction'

describe('provider error redaction', () => {
	it('redacts bearer headers, query tokens, json token fields, and known secrets', () => {
		const message =
			'Authorization: Bearer moysklad-token access_token=moysklad-token ' +
			'https://api.example.test/path?token=moysklad-token&ok=1 ' +
			'{"apiKey":"moysklad-token","name":"Product"}'

		const result = redactProviderSecrets(message, ['moysklad-token'])

		expect(result).toContain('[redacted]')
		expect(result).toContain('ok=1')
		expect(result).toContain('"name":"Product"')
		expect(result).not.toContain('moysklad-token')
	})

	it('redacts sensitive object fields while preserving non-sensitive data', () => {
		const result = redactProviderSecretsDeep({
			status: 401,
			authorization: 'Bearer token-value',
			nested: {
				accessToken: 'token-value',
				name: 'Visible'
			}
		})

		expect(result).toEqual({
			status: 401,
			authorization: '[redacted]',
			nested: {
				accessToken: '[redacted]',
				name: 'Visible'
			}
		})
	})

	it('renders safe Error instances for logs and telemetry', () => {
		const raw = new Error('provider failed with Bearer token-value')
		const message = renderSafeProviderErrorMessage(raw)
		const safeError = toSafeProviderError(raw)

		expect(message).toBe('provider failed with Bearer [redacted]')
		expect(safeError.message).toBe(message)
		expect(safeError.message).not.toContain('token-value')
	})
})
