import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
	IsDateString,
	IsNotEmpty,
	IsNumber,
	IsOptional,
	IsString,
	Min
} from 'class-validator'

function trimOptionalString(value: unknown) {
	if (value === undefined || value === null) return value
	if (typeof value !== 'string') return value
	const normalized = value.trim()
	return normalized.length ? normalized : undefined
}

export class AdminCreatePromoPaymentDtoReq {
	@ApiProperty({ type: String, example: 'promo-code uuid' })
	@Transform(({ value }: { value: unknown }) => trimOptionalString(value))
	@IsString()
	@IsNotEmpty()
	promoCodeId: string

	@ApiPropertyOptional({ type: Number, example: 1000 })
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined || value === null || value === '') return undefined
		return Number(value)
	})
	@IsOptional()
	@IsNumber()
	@Min(0)
	amount?: number

	@ApiPropertyOptional({ type: String, format: 'date-time' })
	@IsOptional()
	@IsDateString()
	paidAt?: string

	@ApiPropertyOptional({ type: String, format: 'date-time' })
	@IsOptional()
	@IsDateString()
	licenseEndsAt?: string
}
