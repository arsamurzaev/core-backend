type AuthSessionMeta = {
	ip?: string | null
	userAgent?: string | null
}

export type IssuedAuthSession = {
	sid: string
	csrf: string
	reused: boolean
}

export const AUTH_SESSION_ISSUER_PORT = Symbol('AUTH_SESSION_ISSUER_PORT')

export interface AuthSessionIssuerPort {
	createSessionForUser(
		userId: string,
		meta?: AuthSessionMeta,
		catalogId?: string | null,
		existingSid?: string | null
	): Promise<IssuedAuthSession>
}
