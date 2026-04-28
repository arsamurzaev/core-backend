import type { Role } from '@generated/enums'
import type { Request } from 'express'

import type { SessionData } from '../session/session.service'

export type SessionUser = {
	id: string
	role: Role
	login?: string | null
	name?: string | null
}

export type AuthRequest = Request & {
	cookies?: Record<string, string | undefined>
	user?: SessionUser
	sessionId?: string
	session?: SessionData
}
