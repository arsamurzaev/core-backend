import { ApiProperty } from '@nestjs/swagger'

import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'

export class MultipartCompleteResponseDto extends OkResponseDto {
	@ApiProperty({ example: 'catalogs/uuid/products/2026/02/09/raw/uuid.jpg' })
	key: string

	@ApiProperty({ example: 'job-id' })
	jobId: string

	@ApiProperty({ example: 1 })
	count: number
}
