import { Logger, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'

import { AppModule } from './core/app.module'
import { AllInterfaces } from './core/config'
import { getCorsConfig, getValidationPipeConfig } from './core/config/cfg'

async function bootstrap() {
	const app = await NestFactory.create(AppModule)
	const config = app.get(ConfigService<AllInterfaces>)
	const logger = new Logger()

	app.enableCors(getCorsConfig(config))

	app.useGlobalPipes(new ValidationPipe(getValidationPipeConfig()))

	const swaggerConfig = new DocumentBuilder()
		.setTitle('Gateway Service')
		.setDescription('The Gateway Service API description')
		.addApiKey({ type: 'apiKey', name: 'X-CSRF-Token', in: 'header' }, 'csrf')
		.setVersion('1.0')
		.build()

	const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig)

	SwaggerModule.setup('/docs', app, swaggerDocument, {
		yamlDocumentUrl: '/openapi.yaml',
		swaggerOptions: {
			withCredentials: true,
			persistAuthorization: true
		}
	})

	const port = config.get('http.port', { infer: true })
	const host = config.get('http.host', { infer: true })

	await app.listen(port)

	logger.log(`🚀 Gateway Service running at ${host}`)
	logger.log(`📂 Swagger Service running at ${host}/docs`)
}
bootstrap()
