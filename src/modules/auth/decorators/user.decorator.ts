import { createParamDecorator, ExecutionContext } from '@nestjs/common'

import type { AuthRequest } from '../types/auth-request'

export const User = createParamDecorator((_, ctx: ExecutionContext) => {
	const req = ctx.switchToHttp().getRequest<AuthRequest>()
	return req.user
})
