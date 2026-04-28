import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

export class AdminCreateActivityDtoReq {
	@ApiProperty({ type: String, example: 'Restaurant' })
	@Transform(({ value }: { value: unknown }) => {
		if (typeof value !== 'string') return value
		return value.trim()
	})
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	name: string

	@ApiProperty({ type: String, example: 'type uuid' })
	@Transform(({ value }: { value: unknown }) => {
		if (typeof value !== 'string') return value
		return value.trim()
	})
	@IsString()
	@IsNotEmpty()
	typeId: string
}
