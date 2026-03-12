import { ContactType } from '@generated/enums'
import type { CatalogUpdateInput } from '@generated/models'
import { BadRequestException } from '@nestjs/common'
import slugify from 'slugify'

import type {
	UpdateCatalogContactDtoReq,
	UpdateCatalogDtoReq
} from './dto/requests/update-catalog.dto.req'

const RESERVED_SUBDOMAINS = new Set(
	(
		process.env.CATALOG_RESERVED_SUBDOMAINS ??
		'www,api,admin,app,static,cdn,assets'
	)
		.split(',')
		.map(value => value.trim().toLowerCase())
		.filter(Boolean)
)

export const CATALOG_SLUG_MAX_LENGTH = 63
export const CATALOG_SLUG_FALLBACK = 'catalog'

export type CatalogUpdateAccess = {
	allowStatus: boolean
	allowType: boolean
	allowOwner: boolean
	allowParent: boolean
}

export function normalizeCatalogSlug(value: string): string {
	return value.trim().toLowerCase()
}

export function normalizeCatalogDomain(value: string | null): string | null {
	if (value === null) return null

	let host = value.trim().toLowerCase()
	if (!host) return null

	host = host.replace(/^https?:\/\//, '')
	host = host.split('/')[0] ?? host
	host = host.split(':')[0] ?? host

	if (host.startsWith('www.')) host = host.slice(4)

	return host || null
}

export function ensureCatalogSlugAllowed(slug: string) {
	if (!isCatalogSlugAllowed(slug)) {
		throw new BadRequestException('Слаг зарезервирован')
	}
}

export function isCatalogSlugAllowed(slug: string) {
	return !RESERVED_SUBDOMAINS.has(slug)
}

export function slugifyCatalogValue(value: string): string {
	const slug = slugify(value, { lower: true, strict: true, trim: true })
	return slug.replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '')
}

export function applyCatalogSlugSuffix(base: string, suffix: number): string {
	const suffixPart = suffix > 0 ? `-${suffix}` : ''
	const headLength = Math.max(0, CATALOG_SLUG_MAX_LENGTH - suffixPart.length)
	const head = base.slice(0, headLength).replace(/-+$/g, '')
	return `${head}${suffixPart}`
}

export function normalizeCatalogContactValue(
	value: string,
	type: ContactType
): string {
	const trimmed = value.trim()
	if (!trimmed) {
		throw new BadRequestException(`Контакт ${type} не может быть пустым`)
	}

	if (
		type === ContactType.PHONE ||
		type === ContactType.SMS ||
		type === ContactType.WHATSAPP
	) {
		const hasLeadingPlus = trimmed.startsWith('+')
		const digits = trimmed.replace(/\D/g, '')

		if (!digits) {
			throw new BadRequestException(`Контакт ${type} содержит некорректный номер`)
		}

		return hasLeadingPlus ? `+${digits}` : digits
	}

	return trimmed
}

export function buildCatalogRelationUpdateData(
	dto: UpdateCatalogDtoReq,
	options: CatalogUpdateAccess
): CatalogUpdateInput {
	const data: CatalogUpdateInput = {}

	if (dto.name !== undefined) {
		data.name = dto.name
	}

	if (options.allowType && dto.typeId) {
		data.type = { connect: { id: dto.typeId } }
	}

	if (options.allowParent && dto.parentId !== undefined) {
		data.parent =
			dto.parentId === null
				? { disconnect: true }
				: { connect: { id: dto.parentId } }
	}

	if (options.allowOwner && dto.userId !== undefined) {
		data.user =
			dto.userId === null ? { disconnect: true } : { connect: { id: dto.userId } }
	}

	return data
}

export function buildCatalogConfigUpsert(
	dto: UpdateCatalogDtoReq,
	options: {
		allowStatus: boolean
		logoMediaId?: string
		bgMediaId?: string
	}
): CatalogUpdateInput['config'] | undefined {
	const update: Record<string, unknown> = {}
	const create: Record<string, unknown> = {}

	if (dto.about !== undefined) {
		update.about = dto.about
		create.about = dto.about
	}

	if (dto.description !== undefined) {
		update.description = dto.description
		create.description = dto.description
	}

	if (dto.currency !== undefined) {
		update.currency = dto.currency
		create.currency = dto.currency
	}

	if (dto.logoMediaId !== undefined) {
		update.logoMediaId = options.logoMediaId
		create.logoMediaId = options.logoMediaId
	}

	if (dto.bgMediaId !== undefined) {
		update.bgMediaId = options.bgMediaId
		create.bgMediaId = options.bgMediaId
	}

	if (dto.note !== undefined) {
		update.note = dto.note
		create.note = dto.note
	}

	if (options.allowStatus && dto.status !== undefined) {
		update.status = dto.status
		create.status = dto.status
	}

	if (!hasValues(update)) return undefined

	return {
		upsert: {
			update,
			create
		}
	} as NonNullable<CatalogUpdateInput['config']>
}

export function buildCatalogSettingsUpsert(
	dto: UpdateCatalogDtoReq
): CatalogUpdateInput['settings'] | undefined {
	const update: Record<string, unknown> = {}
	const create: Record<string, unknown> = {}

	if (dto.isActive !== undefined) {
		update.isActive = dto.isActive
		create.isActive = dto.isActive
	}

	if (dto.googleVerification !== undefined) {
		update.googleVerification = dto.googleVerification
		create.googleVerification = dto.googleVerification
	}

	if (dto.yandexVerification !== undefined) {
		update.yandexVerification = dto.yandexVerification
		create.yandexVerification = dto.yandexVerification
	}

	if (!hasValues(update)) return undefined

	return {
		upsert: {
			update,
			create
		}
	} as NonNullable<CatalogUpdateInput['settings']>
}

export function buildCatalogContactsUpdate(
	contacts?: UpdateCatalogContactDtoReq[]
): CatalogUpdateInput['contacts'] | undefined {
	if (contacts === undefined) return undefined

	const seenTypes = new Set<ContactType>()
	const contactItems = contacts.map((contact, index) => {
		if (seenTypes.has(contact.type)) {
			throw new BadRequestException(
				`Контакт типа ${contact.type} передан больше одного раза`
			)
		}

		seenTypes.add(contact.type)

		return {
			type: contact.type,
			position: contact.position ?? index,
			value: normalizeCatalogContactValue(contact.value, contact.type)
		}
	})

	const relation = { deleteMany: {} } as NonNullable<
		CatalogUpdateInput['contacts']
	>
	if (contactItems.length > 0) {
		relation.create = contactItems
	}

	return relation
}

function hasValues(value: Record<string, unknown>): boolean {
	return Object.keys(value).length > 0
}
