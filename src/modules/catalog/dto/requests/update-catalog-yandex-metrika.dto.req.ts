import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsString, Matches, MaxLength, MinLength } from 'class-validator'

export class UpdateCatalogYandexMetrikaDtoReq {
	@ApiProperty({
		type: String,
		example: '12345678',
		description: 'Yandex Metrika counter id for CATALOG scope.'
	})
	@IsString()
	@MinLength(3)
	@MaxLength(20)
	@Matches(/^\d+$/, {
		message: 'counterId должен содержать только цифры'
	})
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' ? value.trim() : value
	)
	counterId: string
}
