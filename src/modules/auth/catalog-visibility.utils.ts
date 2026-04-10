import { Role } from '@generated/enums'

import type { SessionUser } from './types/auth-request'

export function canReadInactiveCatalogProducts(
	user: SessionUser | undefined,
	ownerUserId?: string | null
): boolean {
	if (!user) return false
	if (user.role === Role.ADMIN) return true
	return (
		user.role === Role.CATALOG && Boolean(ownerUserId) && ownerUserId === user.id
	)
}
