import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsInt, IsOptional, Max, Min } from 'class-validator'

function normalizeInteger(value: unknown): unknown {
	if (typeof value === 'number') return value
	if (typeof value !== 'string') return value
	const normalized = Number(value.trim())
	return Number.isFinite(normalized) ? normalized : value
}

export class AdminDefaultVariantDiagnosticsQueryDtoReq {
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
