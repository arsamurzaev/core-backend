import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator'

export class UpsertCartItemDtoReq {
	@ApiProperty({
		type: String,
		format: 'uuid',
		example: 'd084ec3f-55cb-4ba4-9f50-c18fd01ea124'
	})
	@IsString()
	@IsNotEmpty()
	productId: string

	@ApiPropertyOptional({
		type: String,
		format: 'uuid',
		example: '9f3f4ec2-9f74-4e03-b8cf-95ce5449cb8e'
	})
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	variantId?: string

	@ApiProperty({
		type: Number,
		example: 2,
		description: '0 = удалить позицию из корзины'
	})
	@Type(() => Number)
	@IsInt()
	@Min(0)
	quantity: number
}

export class PublicUpsertCartItemDtoReq extends UpsertCartItemDtoReq {
	@ApiProperty({
		type: String,
		example: '7b5f8d06f87d14d4a4f1f3f9826459fd9f9a'
	})
	@IsString()
	@IsNotEmpty()
	checkoutKey: string
}
