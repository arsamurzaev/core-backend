import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsUUID } from 'class-validator'

export class MergeAttributeEnumValuesDtoReq {
	@ApiProperty({ type: String, format: 'uuid' })
	@IsUUID()
	@IsNotEmpty()
	targetId: string
}
