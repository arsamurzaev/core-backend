import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, Min } from 'class-validator'

export class UpdateCategoryPositionDtoReq {
	@ApiProperty({
		type: Number,
		example: 0,
		description: 'Новая позиция категории среди соседних категорий',
		minimum: 0
	})
	@Type(() => Number)
	@IsInt()
	@Min(0)
	position: number
}
