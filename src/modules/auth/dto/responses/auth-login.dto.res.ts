import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'

import { AuthUserDto } from './auth-user.dto.res'

export class AuthLoginResponseDto extends OkResponseDto {
	@ApiProperty({ type: AuthUserDto })
	user: AuthUserDto

	@ApiPropertyOptional({ type: String, nullable: true })
	catalogId?: string | null
}
