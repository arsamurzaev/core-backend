import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
	IsBoolean,
	IsIn,
	IsISO8601,
	IsObject,
	IsOptional
} from 'class-validator'

import {
	CATALOG_CAPABILITIES,
	type CatalogCapability
} from '@/modules/capability/capability.constants'

export class AdminUpdateCatalogFeatureEntitlementDtoReq {
	@ApiProperty({ enum: CATALOG_CAPABILITIES })
	@IsIn(CATALOG_CAPABILITIES)
	feature: CatalogCapability

	@ApiProperty({ type: Boolean })
	@IsBoolean()
	enabled: boolean

	@ApiPropertyOptional({
		type: String,
		format: 'date-time',
		nullable: true,
		description: 'When omitted the entitlement does not expire.'
	})
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined) return undefined
		if (value === null || value === '') return null
		return value
	})
	@IsOptional()
	@IsISO8601()
	expiresAt?: string | null

	@ApiPropertyOptional({
		type: Object,
		nullable: true,
		description: 'Optional admin metadata for audit/support context.'
	})
	@IsOptional()
	@IsObject()
	metadata?: Record<string, unknown> | null
}
