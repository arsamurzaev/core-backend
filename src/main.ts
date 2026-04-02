import { Logger, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import helmet from 'helmet'

import { AppModule } from './core/app.module'
import { AllInterfaces } from './core/config'
import { getCorsConfig, getValidationPipeConfig } from './core/config/cfg'
import { AppLogger } from './infrastructure/observability/app-logger'
import { initTracing } from './infrastructure/observability/tracing'

initTracing()

async function bootstrap() {
	const appLogger = new AppLogger()
	const app = await NestFactory.create(AppModule, {
		bufferLogs: true,
		logger: appLogger
	})
	const config = app.get(ConfigService<AllInterfaces>)

	app.useLogger(appLogger)
	Logger.overrideLogger(appLogger)

	app.use(helmet())
	app.enableCors(getCorsConfig(config))
	app.useGlobalPipes(new ValidationPipe(getValidationPipeConfig()))

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

	const port = config.get('http.port', { infer: true })
	const host = config.get('http.host', { infer: true })

	await app.listen(port)

	appLogger.log(`Service started on ${host}`, 'Bootstrap')
	appLogger.log(`Swagger available at ${host}/docs`, 'Bootstrap')
}

void bootstrap()
