import {
	ExecutionContext,
	HttpException,
	HttpStatus,
	Injectable
} from '@nestjs/common'
import { ThrottlerGuard } from '@nestjs/throttler'
import type { ThrottlerLimitDetail } from '@nestjs/throttler'
import type { Request } from 'express'

import { readCookieValue } from '@/shared/http/cookie.utils'
import { buildRateLimitMessage } from '@/shared/http/error-message.utils'

const SID_COOKIE = process.env.SESSION_COOKIE_NAME ?? 'sid'

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
	protected shouldSkip(context: ExecutionContext): Promise<boolean> {
		const req = context.switchToHttp().getRequest<Request>()
		const method: string = req.method ?? ''

		// Анонимные GET/HEAD запросы не ограничиваем — nginx уже защищает
		// Авторизованные пользователи всегда проходят через throttle по session ID
		const hasSid = Boolean(readCookieValue(req.headers.cookie, SID_COOKIE))
		return Promise.resolve(!hasSid && (method === 'GET' || method === 'HEAD'))
	}

	protected throwThrottlingException(
		_context: ExecutionContext,
		detail: ThrottlerLimitDetail
	): Promise<void> {
		const msRemaining = detail.isBlocked
			? detail.timeToBlockExpire
			: detail.timeToExpire

		const message = buildRateLimitMessage(msRemaining)
		throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS)
	}
}
