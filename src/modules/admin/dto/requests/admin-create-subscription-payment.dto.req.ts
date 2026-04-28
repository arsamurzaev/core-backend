import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsDateString, IsNumber, IsOptional, Min } from 'class-validator'

export class AdminCreateSubscriptionPaymentDtoReq {
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
