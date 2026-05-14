import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsOptional, IsString } from 'class-validator'

export class ProductTypeCompatibilityPreviewDtoReq {
	@ApiProperty({
		type: String,
		nullable: true,
		description: 'Next product type inside current catalog. Pass null to clear.'
	})
	@IsOptional()
	@IsString()
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined) return undefined
		if (value === null) return null
		if (typeof value !== 'string') return value
		const normalized = value.trim()
		return normalized.length ? normalized : null
	})
	productTypeId?: string | null
}
