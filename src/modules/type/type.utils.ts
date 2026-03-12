import slugify from 'slugify'

export const TYPE_CODE_PATTERN = /^[a-z0-9-]+$/

const TYPE_CODE_MAX_LENGTH = 50
const TYPE_CODE_FALLBACK = 'type'

export function normalizeTypeCode(value: string): string {
	return value.trim().toLowerCase()
}

export function buildTypeCodeBase(name: string): string {
	return slugifyTypeValue(name) || TYPE_CODE_FALLBACK
}

export async function generateUniqueTypeCode(
	base: string,
	exists: (candidate: string) => Promise<boolean>
): Promise<string> {
	let candidate = applyTypeCodeSuffix(base, 0)
	let suffix = 1

	while (await exists(candidate)) {
		candidate = applyTypeCodeSuffix(base, suffix)
		suffix += 1
	}

	return candidate
}

function applyTypeCodeSuffix(base: string, suffix: number): string {
	const suffixPart = suffix > 0 ? `-${suffix}` : ''
	const headLength = Math.max(0, TYPE_CODE_MAX_LENGTH - suffixPart.length)
	const head = base.slice(0, headLength).replace(/-+$/g, '')
	return `${head}${suffixPart}`
}

function slugifyTypeValue(value: string): string {
	const slug = slugify(value, { lower: true, strict: true, trim: true })
	return slug.replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '')
}
