import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator'

export class CreateCatalogDomainDtoReq {
	@ApiProperty({
		type: String,
		example: 'kingsname.ru'
	})
	@IsString()
	@MaxLength(253)
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' ? value.trim() : value
	)
	hostname: string

	@ApiPropertyOptional({
		type: Boolean,
		example: true,
		description: 'Also allow www.<domain> for TLS and DNS checks'
	})
	@IsOptional()
	@IsBoolean()
	includeWww?: boolean

	@ApiPropertyOptional({
		type: Boolean,
		example: true
	})
	@IsOptional()
	@IsBoolean()
	isPrimary?: boolean

	@ApiPropertyOptional({
		type: Boolean,
		example: true
	})
	@IsOptional()
	@IsBoolean()
	redirectToPrimary?: boolean
}
