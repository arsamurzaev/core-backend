import { ApiProperty } from '@nestjs/swagger'

import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'

export class MultipartPartResponseDto extends OkResponseDto {
	@ApiProperty({ example: 1 })
	partNumber: number

	@ApiProperty({ example: 'https://s3.amazonaws.com/...signed...' })
	uploadUrl: string
}
