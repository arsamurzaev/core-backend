/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { randomUUID } from 'node:crypto'

import { CatalogResolver } from './catalog.resolver'
import { RequestContext, type RequestContextStore } from './request-context'

function isSwaggerRoute(req: Request): boolean {
	const url = req.originalUrl ?? req.url ?? ''
	const path = url.split('?')[0] ?? ''
	return (
		path.startsWith('/docs') ||
		path === '/openapi.json' ||
		path === '/openapi.yaml'
	)
}

function normalizeHost(raw: string): string {
	let host = raw.split(',')[0]?.trim().toLowerCase() ?? ''
	host = host.replace(/^https?:\/\//, '')
	host = host.split('/')[0] ?? host
	host = host.split(':')[0] ?? host
	if (host.startsWith('www.')) host = host.slice(4)
	return host
}

function getNormalizedHost(req: Request): string {
	const xf = req.headers['x-forwarded-host']
	const xfHost = Array.isArray(xf)
		? xf[0]
		: typeof xf === 'string'
			? xf
			: undefined

	const raw =
		xfHost ??
		(typeof req.headers.host === 'string' ? req.headers.host : undefined) ??
		req.hostname

	return raw ? normalizeHost(raw) : ''
}

function parseCsvEnv(name: string, fallback: string[]): string[] {
	const v = process.env[name]
	if (!v) return fallback
	return v
		.split(',')
		.map(s => s.trim().toLowerCase())
		.filter(Boolean)
}

const BASE_DOMAINS = parseCsvEnv('CATALOG_BASE_DOMAINS', ['myctlg.ru'])

const RESERVED_SUBDOMAINS = new Set(
	parseCsvEnv('CATALOG_RESERVED_SUBDOMAINS', [
		'www',
		'api',
		'admin',
		'app',
		'static',
		'cdn',
		'assets'
	])
)

// Вернёт slug, если host = {slug}.{baseDomain}
function extractSlug(host: string): string | null {
	if (!host) return null

	for (const base of BASE_DOMAINS) {
		if (host === base) continue

		if (host.endsWith('.' + base)) {
			const left = host.slice(0, -(base.length + 1)) // убрали ".base"
			const slug = left.split('.')[0]?.trim() // single-label slug
			if (!slug) return null
			if (RESERVED_SUBDOMAINS.has(slug)) return null
			return slug
		}
	}

	return null
}

@Injectable()
export class CatalogContextMiddleware implements NestMiddleware {
	constructor(private readonly resolver: CatalogResolver) {}

	async use(req: Request, _res: Response, next: NextFunction) {
		const requestId = randomUUID()
		const host = getNormalizedHost(req)

		_res.setHeader('x-request-id', requestId)

		if (isSwaggerRoute(req)) {
			const store: RequestContextStore = {
				requestId,
				host,
				skipCatalog: true
			}

			RequestContext.run(store, () => {
				;(req as any).requestId = requestId
				next()
			})
			return
		}

		try {
			const slug = extractSlug(host)

			// основной сценарий: поддомен
			const resolved = slug
				? await this.resolver.resolveBySlug(slug)
				: await this.resolver.resolveByDomain(host) // редкий сценарий: кастомный домен

			const store: RequestContextStore = {
				requestId,
				host,
				catalogId: resolved?.catalogId,
				catalogSlug: resolved?.slug,
				typeId: resolved?.typeId,
				ownerUserId: resolved?.ownerUserId ?? null
			}

			RequestContext.run(store, () => {
				;(req as any).requestId = requestId
				if (resolved?.catalogId) (req as any).catalogId = resolved.catalogId
				next()
			})
		} catch (err) {
			next(err)
		}
	}
}
