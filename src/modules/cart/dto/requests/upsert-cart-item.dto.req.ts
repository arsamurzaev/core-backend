import { CartCheckoutMethod } from '@generated/enums'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
	IsInt,
	IsNotEmpty,
	IsObject,
	IsEnum,
	IsOptional,
	IsString,
	MaxLength,
	Min
} from 'class-validator'

export class ShareCurrentCartDtoReq {
	@ApiPropertyOptional({
		type: String,
		maxLength: 1000,
		example: 'Позвоните перед доставкой'
	})
	@IsOptional()
	@IsString()
	@MaxLength(1000)
	comment?: string

	@ApiPropertyOptional({
		enum: CartCheckoutMethod,
		example: CartCheckoutMethod.DELIVERY
	})
	@IsOptional()
	@IsEnum(CartCheckoutMethod)
	checkoutMethod?: CartCheckoutMethod

	@ApiPropertyOptional({
		type: Object,
		example: { personsCount: 4, visitTime: '19:30' }
	})
	@IsOptional()
	@IsObject()
	checkoutData?: Record<string, unknown>
}

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

export class PublicUpsertCartItemDtoReq extends UpsertCartItemDtoReq {}
