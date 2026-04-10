import { Controller, Get, Header, NotFoundException, Res } from '@nestjs/common'
import { ApiExcludeController } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import type { Response } from 'express'

import { resolveObservabilitySettings } from '@/infrastructure/observability/observability.settings'
import { SkipCatalog } from '@/shared/tenancy/decorators/skip-catalog.decorator'

import { ObservabilityService } from './observability.service'

const observabilitySettings = resolveObservabilitySettings()

@ApiExcludeController()
@SkipThrottle()
@SkipCatalog()
@Controller()
export class ObservabilityController {
	constructor(private readonly observability: ObservabilityService) {}

	@Get(observabilitySettings.metricsPath)
	@Header('Cache-Control', 'no-store')
	async metrics(@Res({ passthrough: true }) res: Response) {
		if (!this.observability.isMetricsEnabled) {
			throw new NotFoundException('Эндпоинт метрик отключён')
		}

		res.setHeader('Content-Type', this.observability.contentType)
		return this.observability.getMetrics()
	}

	@Get('/observability/health')
	getHealth() {
		return this.observability.getHealth()
	}
}
