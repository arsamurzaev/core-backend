import { Role } from '@generated/enums'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator'

import { AdminPaginationDto } from './admin-pagination.dto'

export class AdminUsersQueryDto extends AdminPaginationDto {
	@ApiPropertyOptional({ example: 'john' })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	search?: string

	@ApiPropertyOptional({ enum: Role })
	@IsOptional()
	@IsEnum(Role)
	role?: Role
}
