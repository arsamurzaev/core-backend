import { Role } from '@generated/enums'
import { ApiProperty } from '@nestjs/swagger'

export class AuthUserDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	login: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ enum: Role })
	role: Role
}
