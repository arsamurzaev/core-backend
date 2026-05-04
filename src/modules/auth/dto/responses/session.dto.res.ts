import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'

class AuthSessionBrowserDto {
	@ApiPropertyOptional({ type: String, nullable: true })
	name: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	version: string | null
}

class AuthSessionOsDto {
	@ApiPropertyOptional({ type: String, nullable: true })
	name: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	version: string | null
}

class AuthSessionDeviceDto {
	@ApiPropertyOptional({ type: String, nullable: true })
	type: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	vendor: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	model: string | null
}

class AuthSessionGeoDto {
	@ApiPropertyOptional({ type: String, nullable: true })
	city: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	region: string | null
}

class AuthSessionClientDto {
	@ApiPropertyOptional({ type: String, nullable: true })
	ip: string | null

	@ApiPropertyOptional({ type: AuthSessionBrowserDto, nullable: true })
	browser: AuthSessionBrowserDto | null

	@ApiPropertyOptional({ type: AuthSessionOsDto, nullable: true })
	os: AuthSessionOsDto | null

	@ApiPropertyOptional({ type: AuthSessionDeviceDto, nullable: true })
	device: AuthSessionDeviceDto | null

	@ApiPropertyOptional({ type: AuthSessionGeoDto, nullable: true })
	geo: AuthSessionGeoDto | null
}

export class AuthSessionDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: Boolean })
	isCurrent: boolean

	@ApiProperty({ type: Boolean })
	isPrimary: boolean

	@ApiProperty({ type: String })
	createdAt: string

	@ApiPropertyOptional({ type: String, nullable: true })
	expiresAt: string | null

	@ApiPropertyOptional({ type: Number, nullable: true })
	ttlSeconds: number | null

	@ApiProperty({ type: AuthSessionClientDto })
	client: AuthSessionClientDto
}

export class AuthSessionsResponseDto extends OkResponseDto {
	@ApiProperty({ type: [AuthSessionDto] })
	sessions: AuthSessionDto[]
}
