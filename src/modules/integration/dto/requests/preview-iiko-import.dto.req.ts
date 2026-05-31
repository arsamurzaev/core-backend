import { ApiPropertyOptional } from '@nestjs/swagger'
import {
	IsInt,
	IsOptional,
	IsString,
	Max,
	MaxLength,
	Min
} from 'class-validator'

export class PreviewIikoImportDtoReq {
	@ApiPropertyOptional({
		type: String,
		description:
			'Optional apiLogin override. If omitted, saved iiko credentials are used.'
	})
	@IsOptional()
	@IsString()
	@MaxLength(500)
	apiLogin?: string

	@ApiPropertyOptional({
		type: String,
		example: '9d97b2a1-0000-0000-0000-000000000001'
	})
	@IsOptional()
	@IsString()
	@MaxLength(64)
	organizationId?: string

	@ApiPropertyOptional({ type: String, example: '81651' })
	@IsOptional()
	@IsString()
	@MaxLength(64)
	externalMenuId?: string

	@ApiPropertyOptional({ type: String, nullable: true, example: 'Main menu' })
	@IsOptional()
	@IsString()
	@MaxLength(255)
	externalMenuName?: string | null

	@ApiPropertyOptional({
		type: String,
		nullable: true,
		example: '9d97b2a1-0000-0000-0000-000000000002'
	})
	@IsOptional()
	@IsString()
	@MaxLength(64)
	priceCategoryId?: string | null

	@ApiPropertyOptional({ type: Number, example: 4 })
	@IsOptional()
	@IsInt()
	@Min(2)
	@Max(4)
	menuVersion?: number
}
