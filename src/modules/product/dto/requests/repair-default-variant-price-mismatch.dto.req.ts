import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator'

function normalizeBoolean(value: unknown): unknown {
	if (typeof value === 'boolean') return value
	if (typeof value !== 'string') return value
	const normalized = value.trim().toLowerCase()
	if (['true', '1', 'yes', 'y'].includes(normalized)) return true
	if (['false', '0', 'no', 'n'].includes(normalized)) return false
	return value
}

function normalizeInteger(value: unknown): unknown {
	if (typeof value === 'number') return value
	if (typeof value !== 'string') return value
	const normalized = Number(value.trim())
	return Number.isFinite(normalized) ? normalized : value
}

export class RepairDefaultVariantPriceMismatchDtoReq {
	@ApiPropertyOptional({
		type: Boolean,
		default: false,
		description:
			'false = dry-run only. true = copy the technical default variant price into legacy Product.price for safe simple products.'
	})
	@IsOptional()
	@IsBoolean()
	@Transform(({ value }: { value: unknown }) => normalizeBoolean(value))
	apply?: boolean

	@ApiPropertyOptional({
		type: Number,
		default: 100,
		minimum: 1,
		maximum: 1000
	})
	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(1000)
	@Transform(({ value }: { value: unknown }) => normalizeInteger(value))
	batchSize?: number

	@ApiPropertyOptional({
		type: Number,
		default: 20,
		minimum: 1,
		maximum: 100
	})
	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(100)
	@Transform(({ value }: { value: unknown }) => normalizeInteger(value))
	sampleLimit?: number
}
