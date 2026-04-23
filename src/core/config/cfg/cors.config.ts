import { type CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface'
import { ConfigService } from '@nestjs/config'

import { CatalogResolver } from '@/shared/tenancy/catalog.resolver'

import { AllInterfaces } from '../interfaces'

function normalizeCorsEntry(entry: string): string {
	return entry.trim().replace(/^['"]|['"]$/g, '')
}

function escapeRegExp(value: string): string {
	return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

function wildcardOriginToRegExp(origin: string): RegExp {
	const normalized = normalizeCorsEntry(origin)
	const hasProtocol = /^[a-z][a-z\d+\-.]*:\/\//i.test(normalized)
	const source = escapeRegExp(normalized).replace(/\*/g, '[^.]+')
	const protocol = hasProtocol ? '' : 'https?:\\/\\/'

	return new RegExp(`^${protocol}${source}(?::\\d+)?$`, 'i')
}

function parseCorsOrigins(cors: string | undefined): string[] {
	return (cors ?? '')
		.split(',')
		.map(normalizeCorsEntry)
		.filter(Boolean)
}

function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
	return allowedOrigins.some((allowedOrigin) => {
		if (allowedOrigin === '*') {
			return true
		}

		if (allowedOrigin.includes('*')) {
			return wildcardOriginToRegExp(allowedOrigin).test(origin)
		}

		return origin === allowedOrigin
	})
}

export function getCorsConfig(
	configService: ConfigService<AllInterfaces>,
	catalogResolver?: CatalogResolver
): CorsOptions {
	const allowedOrigins = parseCorsOrigins(
		configService.get('http.cors', { infer: true })
	)

	return {
		origin: (origin, callback) => {
			if (!origin) {
				callback(null, true)
				return
			}

			if (isOriginAllowed(origin, allowedOrigins)) {
				callback(null, true)
				return
			}

			// Кастомный домен: проверяем по БД через resolveByDomain
			if (catalogResolver) {
				let hostname: string
				try {
					hostname = new URL(origin).hostname
				} catch {
					callback(null, false)
					return
				}
				catalogResolver
					.resolveByDomain(hostname)
					.then(catalog => callback(null, catalog !== null))
					.catch(() => callback(null, false))
				return
			}

			callback(null, false)
		},
		credentials: true
	}
}
