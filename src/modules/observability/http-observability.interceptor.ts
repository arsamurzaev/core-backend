import {
	CallHandler,
	ExecutionContext,
	Injectable,
	Logger,
	NestInterceptor
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { finalize, Observable } from 'rxjs'

import { getClientInfo } from '@/shared/http/utils/client-info'

import {
	normalizeHttpRouteForMetrics,
	shouldSkipHttpObservability
} from './http-observability.utils'
import { ObservabilityService } from './observability.service'

@Injectable()
export class HttpObservabilityInterceptor implements NestInterceptor {
	private readonly logger = new Logger(HttpObservabilityInterceptor.name)

	constructor(private readonly observability: ObservabilityService) {}

	intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
		if (context.getType() !== 'http') {
			return next.handle()
		}

		if (!this.observability.isEnabled) {
			return next.handle()
		}

		const http = context.switchToHttp()
		const req = http.getRequest<Request>()
		const res = http.getResponse<Response>()

		if (shouldSkipHttpObservability(req)) {
			return next.handle()
		}

		const method = req.method.toUpperCase()
		const route = normalizeHttpRouteForMetrics(req)
		const start = process.hrtime.bigint()
		const clientInfo = getClientInfo(req)

		this.observability.incrementHttpInFlight(method, route)

		return next.handle().pipe(
			finalize(() => {
				const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000
				const statusCode = res.statusCode || 500

				this.observability.decrementHttpInFlight(method, route)
				this.observability.recordHttpRequest(method, route, statusCode, durationMs)

				this.logger.log({
					event: 'http_request_completed',
					method,
					route,
					statusCode,
					durationMs: Number(durationMs.toFixed(3)),
					contentLength: res.getHeader('content-length') ?? null,
					clientIp: clientInfo.ip || null,
					userAgent: clientInfo.userAgent
				} as any)
			})
		)
	}
}
