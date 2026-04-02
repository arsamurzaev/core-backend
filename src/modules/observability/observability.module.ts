import { Global, Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'

import { HttpObservabilityInterceptor } from './http-observability.interceptor'
import { ObservabilityController } from './observability.controller'
import { ObservabilityService } from './observability.service'

@Global()
@Module({
	controllers: [ObservabilityController],
	providers: [
		ObservabilityService,
		{
			provide: APP_INTERCEPTOR,
			useClass: HttpObservabilityInterceptor
		}
	],
	exports: [ObservabilityService]
})
export class ObservabilityModule {}
