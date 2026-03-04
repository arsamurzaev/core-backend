import { BadRequestException } from '@nestjs/common'

export function normalizeRequiredString(
	value: string,
	fieldName: string
): string {
	const normalized = String(value).trim()
	if (!normalized) {
		throw new BadRequestException(`Поле ${fieldName} обязательно`)
	}
	return normalized
}

export function normalizeOptionalId(value?: string): string | undefined {
	if (value === undefined) return undefined
	const normalized = String(value).trim()
	return normalized || undefined
}

export function normalizeNullableTrimmedString(
	value?: string | null
): string | null | undefined {
	if (value === undefined) return undefined
	if (value === null) return null
	const normalized = String(value).trim()
	return normalized.length ? normalized : null
}

export function normalizeOptionalNonEmptyString(
	value?: string | null,
	fieldName = 'value'
): string | null | undefined {
	if (value === undefined || value === null) return value
	const normalized = String(value).trim()
	if (!normalized) {
		throw new BadRequestException(`Поле ${fieldName} обязательно`)
	}
	return normalized
}

export function assertHasUpdateFields(
	data: object,
	message = 'Нет полей для обновления'
): void {
	if (Object.keys(data).length === 0) {
		throw new BadRequestException(message)
	}
}
