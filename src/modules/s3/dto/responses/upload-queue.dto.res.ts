import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'

import { UploadImageResponseDto } from './upload-image.dto.res'

export class UploadQueueResponseDto extends OkResponseDto {
	@ApiProperty({ example: '12345' })
	jobId: string

	@ApiProperty({ example: 3 })
	count: number
}

export class UploadQueueStatusDto extends OkResponseDto {
	@ApiProperty({ example: 'active' })
	status: string

	@ApiProperty({ example: 45 })
	progress: number

	@ApiPropertyOptional({
		type: UploadImageResponseDto,
		description: 'Результат для одного файла'
	})
	result?: UploadImageResponseDto

	@ApiPropertyOptional({
		type: [UploadImageResponseDto],
		description: 'Результаты для массива файлов'
	})
	results?: UploadImageResponseDto[]

	@ApiPropertyOptional({ example: 'Описание ошибки' })
	error?: string
}
