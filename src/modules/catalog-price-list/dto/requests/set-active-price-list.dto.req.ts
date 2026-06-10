import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsOptional, IsString } from 'class-validator'

function trimNullableString(value: unknown): string | null | undefined {
	if (value === undefined) return undefined
	if (value === null) return null
	if (typeof value !== 'string') return value as string
	const trimmed = value.trim()
	return trimmed.length ? trimmed : null
}

export class SetActivePriceListDtoReq {
	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@Transform(({ value }: { value: unknown }) => trimNullableString(value))
	activePriceListId?: string | null
}
