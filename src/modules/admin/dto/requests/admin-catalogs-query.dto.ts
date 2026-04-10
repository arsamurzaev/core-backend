import { CatalogStatus } from '@generated/enums'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator'

import { AdminPaginationDto } from './admin-pagination.dto'

export class AdminCatalogsQueryDto extends AdminPaginationDto {
	@ApiPropertyOptional({ example: 'my-shop' })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	search?: string

	@ApiPropertyOptional({ enum: CatalogStatus })
	@IsOptional()
	@IsEnum(CatalogStatus)
	status?: CatalogStatus
}
