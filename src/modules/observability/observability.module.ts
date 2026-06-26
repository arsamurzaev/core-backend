import { Global, Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'

import { OBSERVABILITY_RECORDER_PORT } from './contracts'
import { HttpObservabilityInterceptor } from './http-observability.interceptor'
import { ObservabilityController } from './observability.controller'
import { ObservabilityService } from './observability.service'

@Global()
@Module({
	controllers: [ObservabilityController],
	providers: [
		ObservabilityService,
		{ provide: OBSERVABILITY_RECORDER_PORT, useExisting: ObservabilityService },
		{
			provide: APP_INTERCEPTOR,
			useClass: HttpObservabilityInterceptor
		}
	],
	exports: [OBSERVABILITY_RECORDER_PORT]
})
export class ObservabilityModule {}
