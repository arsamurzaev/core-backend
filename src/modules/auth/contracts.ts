import type { Role } from '@generated/client'

import type { SessionData, SessionLoginEntry } from './session/session.utils'

type AuthSessionMeta = {
	ip?: string | null
	userAgent?: string | null
}

export type AuthActiveSessionEntry = SessionLoginEntry & {
	expiresAt: number | null
	ttlSeconds: number | null
}

export type IssuedAuthSession = {
	sid: string
	csrf: string
	reused: boolean
}

export type AuthPasswordChangeInput = {
	currentPassword: string
	newPassword: string
}

export const AUTH_SESSION_ISSUER_PORT = Symbol('AUTH_SESSION_ISSUER_PORT')
export const AUTH_PASSWORD_COMMAND_PORT = Symbol('AUTH_PASSWORD_COMMAND_PORT')
export const AUTH_SESSION_MANAGEMENT_PORT = Symbol(
	'AUTH_SESSION_MANAGEMENT_PORT'
)
export const AUTH_HANDOFF_ISSUER_PORT = Symbol('AUTH_HANDOFF_ISSUER_PORT')

export interface AuthSessionIssuerPort {
	createSessionForUser(
		userId: string,
		meta?: AuthSessionMeta,
		catalogId?: string | null,
		existingSid?: string | null
	): Promise<IssuedAuthSession>
}

export interface AuthPasswordCommandPort {
	changePassword(
		userId: string,
		dto: AuthPasswordChangeInput,
		currentSessionId?: string | null
	): Promise<void>
}

export interface AuthSessionManagementPort {
	get(sid: string): Promise<SessionData | null>
	touch(sid: string, userId: string, ttlSeconds?: number): Promise<void>
	listActiveForUser(userId: string): Promise<AuthActiveSessionEntry[]>
	destroyForUser(userId: string, sid: string): Promise<boolean>
	destroyAllForUserExcept(userId: string, keepSid: string): Promise<void>
}

export interface AuthHandoffIssuerPort {
	createForCatalog(params: {
		userId: string
		role: Role
		catalogId: string
		next?: string
	}): Promise<string>
}
