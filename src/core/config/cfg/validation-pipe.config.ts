import { BadRequestException, ValidationPipeOptions } from '@nestjs/common'
import type { ValidationError } from 'class-validator'

import { collectValidationErrorMessages } from '@/shared/http/error-message.utils'

export function getValidationPipeConfig(): ValidationPipeOptions {
	return {
		whitelist: true,
		transform: true,
		forbidNonWhitelisted: true,
		exceptionFactory: (errors: ValidationError[]) =>
			new BadRequestException(collectValidationErrorMessages(errors)),
		transformOptions: { enableImplicitConversion: true }
	}
}
