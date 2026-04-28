import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

function trimString(value: unknown) {
	if (typeof value !== 'string') return value
	return value.trim()
}

export class AdminCreatePromoCodeDtoReq {
	@ApiProperty({ type: String, example: 'PARTNER10' })
	@Transform(({ value }: { value: unknown }) => trimString(value))
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	name: string

	@ApiProperty({ type: String, example: 'Ivan' })
	@Transform(({ value }: { value: unknown }) => trimString(value))
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	firstName: string

	@ApiProperty({ type: String, example: 'Ivanov' })
	@Transform(({ value }: { value: unknown }) => trimString(value))
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	lastName: string

	@ApiProperty({ type: String, example: 'Ivanovich' })
	@Transform(({ value }: { value: unknown }) => trimString(value))
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	surName: string

	@ApiProperty({ type: String, example: '10%' })
	@Transform(({ value }: { value: unknown }) => trimString(value))
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	bet: string
}
