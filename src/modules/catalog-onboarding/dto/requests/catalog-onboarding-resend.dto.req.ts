import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsEmail, MaxLength } from 'class-validator'

export class CatalogOnboardingResendDtoReq {
	@ApiProperty({ type: String, example: 'owner@example.com' })
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' ? value.trim().toLowerCase() : value
	)
	@IsEmail()
	@MaxLength(320)
	email: string
}
