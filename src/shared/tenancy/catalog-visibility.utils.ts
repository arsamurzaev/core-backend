import { Role } from '@generated/enums'

export type CatalogVisibilityUser = {
	id: string
	role: Role
}

export function canReadInactiveCatalogProducts(
	user: CatalogVisibilityUser | undefined,
	ownerUserId?: string | null
): boolean {
	if (!user) return false
	if (user.role === Role.ADMIN) return true
	return (
		user.role === Role.CATALOG && Boolean(ownerUserId) && ownerUserId === user.id
	)
}
