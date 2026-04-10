import { CatalogStatus } from '@generated/enums'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
	IsDate,
	IsEnum,
	IsOptional,
	IsString,
	MaxLength
} from 'class-validator'

export class AdminUpdateCatalogDto {
	@ApiPropertyOptional({ example: 'Мой магазин' })
	@IsOptional()
	@IsString()
	@MaxLength(120)
	name?: string

	@ApiPropertyOptional({ example: 'myshop.ru' })
	@IsOptional()
	@IsString()
	@MaxLength(253)
	domain?: string | null

	@ApiPropertyOptional({ enum: CatalogStatus })
	@IsOptional()
	@IsEnum(CatalogStatus)
	status?: CatalogStatus

	@ApiPropertyOptional({ example: 'Внутренняя заметка' })
	@IsOptional()
	@IsString()
	@MaxLength(1000)
	note?: string | null

	@ApiPropertyOptional({ example: '2027-01-01T00:00:00.000Z' })
	@IsOptional()
	@Type(() => Date)
	@IsDate()
	subscriptionEndsAt?: Date | null
}
