import type { INestApplication } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'

export function createOpenApiDocument(app: INestApplication) {
	const swaggerConfig = new DocumentBuilder()
		.setTitle('Gateway Service')
		.setDescription('The Gateway Service API description')
		.addApiKey({ type: 'apiKey', name: 'X-CSRF-Token', in: 'header' }, 'csrf')
		.setVersion('1.0')
		.build()

	return SwaggerModule.createDocument(app, swaggerConfig, {
		operationIdFactory: (controllerKey, methodKey) =>
			`${controllerKey}_${methodKey}`
	})
}
