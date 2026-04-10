import type { ExecutionContext } from '@nestjs/common'
import { applyDecorators, SetMetadata } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'

export const AUTH_THROTTLE_KEY = 'authThrottle'
const AUTH_THROTTLE_OPTIONS = { auth: { limit: 10, ttl: 900_000 } } as const

export function AuthThrottle() {
	return applyDecorators(
		SetMetadata(AUTH_THROTTLE_KEY, true),
		Throttle(AUTH_THROTTLE_OPTIONS)
	)
}

export function shouldApplyAuthThrottle(context: ExecutionContext): boolean {
	return [context.getHandler(), context.getClass()].some(target =>
		Boolean(Reflect.getMetadata(AUTH_THROTTLE_KEY, target))
	)
}
