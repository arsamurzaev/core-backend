import { Controller, Post, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'

import { SessionGuard } from './guards/session.guard'
import { SessionService } from './session/session.service'

const SID_COOKIE = process.env.SESSION_COOKIE_NAME ?? 'sid'
const CSRF_COOKIE = process.env.CSRF_COOKIE_NAME ?? 'csrf'
const SAME_SITE = (process.env.COOKIE_SAMESITE ?? 'strict') as 'strict' | 'lax'
const isProd = process.env.NODE_ENV === 'production'

@Controller('/auth')
export class AuthController {
	constructor(private readonly sessions: SessionService) {}

	@UseGuards(SessionGuard)
	@Post('/logout')
	async logout(@Res({ passthrough: true }) res: Response) {
		const sid = (res.req as any).sessionId as string | undefined
		if (sid) await this.sessions.destroy(sid)

		res.setHeader('Cache-Control', 'no-store')

		// важно: параметры должны совпадать с установкой cookie (path, sameSite, secure)
		res.clearCookie(SID_COOKIE, {
			path: '/',
			sameSite: SAME_SITE,
			secure: isProd
		})
		res.clearCookie(CSRF_COOKIE, {
			path: '/',
			sameSite: SAME_SITE,
			secure: isProd
		})

		return { ok: true }
	}
}
