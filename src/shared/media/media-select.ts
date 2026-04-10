import type { Prisma } from '@generated/client'

import {
	MEDIA_VARIANT_NAMES,
	normalizeMediaVariantName
} from './media-url.service'

const mediaVariantSelect = {
	id: true,
	kind: true,
	mimeType: true,
	size: true,
	width: true,
	height: true,
	storage: true,
	key: true
} satisfies Prisma.MediaVariantSelect

const mediaVariantOrderBy = [
	{ width: 'desc' as const },
	{ kind: 'asc' as const }
]

const MEDIA_VARIANT_KIND_ALIASES: Record<string, string[]> = {
	[MEDIA_VARIANT_NAMES.thumb]: [MEDIA_VARIANT_NAMES.thumb, 'sm'],
	[MEDIA_VARIANT_NAMES.card]: [MEDIA_VARIANT_NAMES.card, 'md'],
	[MEDIA_VARIANT_NAMES.detail]: [MEDIA_VARIANT_NAMES.detail, 'xl']
}

function buildVariantKindClauses(
	kind: string
): Prisma.MediaVariantWhereInput[] {
	return [{ kind }, { kind: { startsWith: `${kind}-` } }]
}

export function buildMediaVariantWhere(
	variantNames?: readonly string[]
): Prisma.MediaVariantWhereInput | undefined {
	if (!variantNames?.length) return undefined

	const kinds = Array.from(
		new Set(
			variantNames
				.map(variantName => normalizeMediaVariantName(variantName))
				.filter(Boolean)
				.flatMap(
					variantName => MEDIA_VARIANT_KIND_ALIASES[variantName] ?? [variantName]
				)
		)
	)

	if (!kinds.length) return undefined

	return {
		OR: kinds.flatMap(kind => buildVariantKindClauses(kind))
	}
}

export function buildMediaSelect(variantNames?: readonly string[]) {
	const where = buildMediaVariantWhere(variantNames)

	return {
		id: true,
		originalName: true,
		mimeType: true,
		size: true,
		width: true,
		height: true,
		status: true,
		storage: true,
		key: true,
		variants: {
			...(where ? { where } : {}),
			select: mediaVariantSelect,
			orderBy: mediaVariantOrderBy
		}
	} satisfies Prisma.MediaSelect
}
