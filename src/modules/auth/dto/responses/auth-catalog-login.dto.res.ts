import { ApiProperty } from '@nestjs/swagger'

import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'

import { AuthUserDto } from './auth-user.dto.res'

export class AuthCatalogLoginResponseDto extends OkResponseDto {
	@ApiProperty({ type: AuthUserDto })
	user: AuthUserDto

	@ApiProperty({ type: String })
	catalogId: string
}
