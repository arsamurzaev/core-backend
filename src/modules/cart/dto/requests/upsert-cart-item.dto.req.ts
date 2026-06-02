import { CartCheckoutMethod } from '@generated/enums'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
	IsEnum,
	IsInt,
	IsNotEmpty,
	IsObject,
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
		example: {
			personsCount: 4,
			visitDate: '2026-05-26',
			visitTime: '19:30'
		}
	})
	@IsOptional()
	@IsObject()
	checkoutData?: Record<string, unknown>
}

export class JoinHallTableSessionDtoReq {
	@ApiPropertyOptional({
		type: String,
		maxLength: 64,
		example: 'guest-f2b8b2'
	})
	@IsOptional()
	@IsString()
	@MaxLength(64)
	guestSessionId?: string

	@ApiPropertyOptional({
		type: String,
		description: 'Private token proving ownership of guestSessionId'
	})
	@IsOptional()
	@IsString()
	guestToken?: string

	@ApiPropertyOptional({
		type: String,
		maxLength: 120,
		example: 'Гость 1'
	})
	@IsOptional()
	@IsString()
	@MaxLength(120)
	guestName?: string

	@ApiPropertyOptional({
		type: Number,
		example: 4
	})
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	guestsCount?: number
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

	@ApiPropertyOptional({
		type: String,
		format: 'uuid',
		example: '0f651b34-c9a7-4e49-92f7-f1545e2711da',
		description: 'Единица продажи выбранной вариации: штука, упаковка, палета.'
	})
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	saleUnitId?: string

	@ApiProperty({
		type: Number,
		example: 2,
		description: '0 = удалить позицию из корзины'
	})
	@Type(() => Number)
	@IsInt()
	@Min(0)
	quantity: number

	@ApiPropertyOptional({
		type: String,
		maxLength: 64,
		example: 'guest-f2b8b2'
	})
	@IsOptional()
	@IsString()
	@MaxLength(64)
	guestSessionId?: string

	@ApiPropertyOptional({
		type: String,
		maxLength: 120,
		example: 'Гость 1'
	})
	@IsOptional()
	@IsString()
	@MaxLength(120)
	guestName?: string
}

export class PublicUpsertCartItemDtoReq extends UpsertCartItemDtoReq {}
