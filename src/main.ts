import { Logger, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { SwaggerModule } from '@nestjs/swagger'
import compression from 'compression'
import * as express from 'express'
import type { Express, NextFunction, Request, Response } from 'express'
import helmet from 'helmet'

import { AppModule } from './core/app.module'
import { AllInterfaces } from './core/config'
import { getCorsConfig, getValidationPipeConfig } from './core/config/cfg'
import { AppLogger } from './infrastructure/observability/app-logger'
import { initTracing } from './infrastructure/observability/tracing'
import { createOpenApiDocument } from './openapi'
import { CatalogResolver } from './shared/tenancy/catalog.resolver'

initTracing()

function parseCsvEnv(name: string, fallback: string[]): string[] {
	const value = process.env[name]
	if (!value) return fallback
	return value
		.split(',')
		.map(item => item.trim().toLowerCase())
		.filter(Boolean)
}

function normalizeHostHeader(value: string | string[] | undefined): string {
	const raw = Array.isArray(value) ? value[0] : value
	let host = (raw ?? '').split(',')[0]?.trim().toLowerCase() ?? ''
	host = host.replace(/^https?:\/\//, '')
	host = host.split('/')[0] ?? host
	host = host.split(':')[0] ?? host
	return host
}

function isLocalHost(host: string): boolean {
	return (
		!host ||
		host === 'localhost' ||
		host.endsWith('.localhost') ||
		host === '127.0.0.1' ||
		host === '::1'
	)
}

function isPlatformHost(host: string): boolean {
	const baseDomains = parseCsvEnv('CATALOG_BASE_DOMAINS', [
		'myctlg.ru',
		'myctlg-update.ru'
	])
	return baseDomains.some(base => host === base || host.endsWith(`.${base}`))
}

async function bootstrap() {
	const appLogger = new AppLogger()
	const app = await NestFactory.create(AppModule, {
		bufferLogs: true,
		logger: appLogger,
		bodyParser: false
	})
	const config = app.get(ConfigService<AllInterfaces>)
	const expressApp = app.getHttpAdapter().getInstance() as Express

	app.useLogger(appLogger)
	Logger.overrideLogger(appLogger)

	expressApp.set('trust proxy', 1)

	app.use(
		'/integration/webhooks/iiko',
		express.text({ type: '*/*', limit: '2mb' })
	)
	app.use(express.json({ limit: '2mb' }))
	app.use(express.urlencoded({ extended: true, limit: '2mb' }))
	app.use(compression())
	app.use(
		helmet({
			hsts: false,
			referrerPolicy: { policy: 'no-referrer' },
			contentSecurityPolicy: false,
			permittedCrossDomainPolicies: { permittedPolicies: 'none' },
			crossOriginEmbedderPolicy: false
		})
	)
	app.use((_req: Request, res: Response, next: NextFunction) => {
		res.setHeader(
			'Permissions-Policy',
			'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()'
		)
		next()
	})
	app.use((req: Request, res: Response, next: NextFunction) => {
		const host = normalizeHostHeader(
			req.headers['x-forwarded-host'] ?? req.headers.host
		)
		if (!isLocalHost(host)) {
			const value = isPlatformHost(host)
				? 'max-age=63072000; includeSubDomains; preload'
				: 'max-age=31536000'
			res.setHeader('Strict-Transport-Security', value)
		}
		next()
	})
	const catalogResolver = app.get(CatalogResolver)
	app.enableCors(getCorsConfig(config, catalogResolver))
	app.useGlobalPipes(new ValidationPipe(getValidationPipeConfig()))

	const port = config.get('http.port', { infer: true })
	const host = config.get('http.host', { infer: true })

	if (process.env.NODE_ENV !== 'production') {
		const swaggerDocument = createOpenApiDocument(app)

		SwaggerModule.setup('/docs', app, swaggerDocument, {
			jsonDocumentUrl: '/openapi.json',
			yamlDocumentUrl: '/openapi.yaml',
			swaggerOptions: {
				withCredentials: true,
				persistAuthorization: true
			}
		})

		appLogger.log(`Swagger available at ${host}/docs`, 'Bootstrap')
	}

	await app.listen(port)

	appLogger.log(`Service started on ${host}`, 'Bootstrap')
}

void bootstrap()
