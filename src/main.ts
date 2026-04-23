import { Logger, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import compression from 'compression'
import * as express from 'express'
import type { Express, NextFunction, Request, Response } from 'express'
import helmet from 'helmet'

import { AppModule } from './core/app.module'
import { AllInterfaces } from './core/config'
import { getCorsConfig, getValidationPipeConfig } from './core/config/cfg'
import { AppLogger } from './infrastructure/observability/app-logger'
import { initTracing } from './infrastructure/observability/tracing'
import { CatalogResolver } from './shared/tenancy/catalog.resolver'

initTracing()

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

	app.use(express.json({ limit: '2mb' }))
	app.use(express.urlencoded({ extended: true, limit: '2mb' }))
	app.use(compression())
	app.use(
		helmet({
			hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
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
	const catalogResolver = app.get(CatalogResolver)
	app.enableCors(getCorsConfig(config, catalogResolver))
	app.useGlobalPipes(new ValidationPipe(getValidationPipeConfig()))

	const port = config.get('http.port', { infer: true })
	const host = config.get('http.host', { infer: true })

	if (process.env.NODE_ENV !== 'production') {
		const swaggerConfig = new DocumentBuilder()
			.setTitle('Gateway Service')
			.setDescription('The Gateway Service API description')
			.addApiKey({ type: 'apiKey', name: 'X-CSRF-Token', in: 'header' }, 'csrf')
			.setVersion('1.0')
			.build()

		const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig, {
			operationIdFactory: (controllerKey, methodKey) =>
				`${controllerKey}_${methodKey}`
		})

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
