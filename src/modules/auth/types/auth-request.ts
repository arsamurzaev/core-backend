import type { Role } from '@generated/enums'
import type { Request } from 'express'

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
}
