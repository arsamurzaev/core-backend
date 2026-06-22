import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

export class CatalogOnboardingConfirmDtoReq {
	@ApiProperty({ type: String, example: 'confirmation-token' })
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' ? value.trim() : value
	)
	@IsString()
	@IsNotEmpty()
	@MaxLength(256)
	token: string
}
