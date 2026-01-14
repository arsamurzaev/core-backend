import { type CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface'
import { ConfigService } from '@nestjs/config'

import { AllInterfaces } from '../interfaces'

export function getCorsConfig(
	configService: ConfigService<AllInterfaces>
): CorsOptions {
	return {
		origin: configService.get('http.cors', { infer: true })?.split(','),
		credentials: true
	}
}
