import { Role } from '@generated/enums'
import { ApiProperty } from '@nestjs/swagger'
import { IsEnum } from 'class-validator'

export class AdminUpdateUserRoleDto {
	@ApiProperty({ enum: Role })
	@IsEnum(Role)
	role: Role
}
