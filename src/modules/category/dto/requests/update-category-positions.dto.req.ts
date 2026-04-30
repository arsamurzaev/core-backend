import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
	ArrayMinSize,
	IsArray,
	IsInt,
	IsUUID,
	Min,
	ValidateNested
} from 'class-validator'

export class UpdateCategoryPositionItemDtoReq {
	@ApiProperty({
		type: String,
		format: 'uuid',
		description: 'ID категории'
	})
	@IsUUID()
	id: string

	@ApiProperty({
		type: Number,
		example: 0,
		description: 'Итоговая позиция категории в списке',
		minimum: 0
	})
	@Type(() => Number)
	@IsInt()
	@Min(0)
	position: number
}

export class UpdateCategoryPositionsDtoReq {
	@ApiProperty({
		type: [UpdateCategoryPositionItemDtoReq],
		description: 'Итоговый порядок категорий'
	})
	@IsArray()
	@ArrayMinSize(1)
	@ValidateNested({ each: true })
	@Type(() => UpdateCategoryPositionItemDtoReq)
	categories: UpdateCategoryPositionItemDtoReq[]
}
