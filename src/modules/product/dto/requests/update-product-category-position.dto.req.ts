import { ApiProperty } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import { IsInt, IsString, Min } from 'class-validator'

export class UpdateProductCategoryPositionDtoReq {
	@ApiProperty({
		type: String,
		example: 'category-uuid',
		description: 'ID категории, внутри которой нужно изменить позицию товара'
	})
	@IsString()
	@Transform(({ value }: { value: unknown }) => {
		if (typeof value !== 'string') return value
		return value.trim()
	})
	categoryId: string

	@ApiProperty({
		type: Number,
		example: 0,
		description: 'Новая позиция товара внутри категории',
		minimum: 0
	})
	@Type(() => Number)
	@IsInt()
	@Min(0)
	position: number
}
