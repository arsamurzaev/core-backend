import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
	ArrayMaxSize,
	IsArray,
	IsBoolean,
	IsIn,
	IsNotEmpty,
	IsOptional,
	IsString,
	IsUUID,
	Matches,
	MaxLength,
	ValidateNested
} from 'class-validator'

const MAPPING_ACTIONS = ['LINK', 'CREATE', 'SKIP'] as const
export type MoySkladMappingAction = (typeof MAPPING_ACTIONS)[number]

function normalizeOptionalString(value: unknown): string | undefined {
	if (value === undefined) return undefined
	if (value === null) return undefined
	if (
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean' ||
		typeof value === 'bigint'
	) {
		return String(value).normalize('NFKC').replace(/\s+/g, ' ').trim()
	}
	return undefined
}

function normalizeOptionalKey(value: unknown): string | undefined {
	const normalized = normalizeOptionalString(value)
	return normalized === undefined ? undefined : normalized.toLowerCase()
}

export class ApplyMoySkladAttributeMappingDtoReq {
	@ApiProperty({ type: String, example: 'Color' })
	@Transform(({ value }: { value: unknown }) => normalizeOptionalString(value))
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	externalName: string

	@ApiProperty({ enum: MAPPING_ACTIONS, example: 'LINK' })
	@Transform(({ value }: { value: unknown }) => {
		const normalized = normalizeOptionalString(value)
		return normalized === undefined ? value : normalized.toUpperCase()
	})
	@IsIn(MAPPING_ACTIONS)
	action: MoySkladMappingAction

	@ApiPropertyOptional({
		type: String,
		description: 'Existing Attribute id for LINK action'
	})
	@IsOptional()
	@IsUUID()
	attributeId?: string

	@ApiPropertyOptional({
		type: String,
		description: 'Optional Attribute key for CREATE action'
	})
	@Transform(({ value }: { value: unknown }) => normalizeOptionalKey(value))
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@Matches(/^[a-z0-9_]+$/)
	@MaxLength(100)
	key?: string

	@ApiPropertyOptional({
		type: String,
		description: 'Optional display name for CREATE action'
	})
	@Transform(({ value }: { value: unknown }) => normalizeOptionalString(value))
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	displayName?: string
}

export class ApplyMoySkladEnumValueMappingDtoReq {
	@ApiProperty({ type: String, example: 'Color' })
	@Transform(({ value }: { value: unknown }) => normalizeOptionalString(value))
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	externalAttributeName: string

	@ApiProperty({ type: String, example: 'Black' })
	@Transform(({ value }: { value: unknown }) => normalizeOptionalString(value))
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	externalValue: string

	@ApiProperty({ enum: MAPPING_ACTIONS, example: 'CREATE' })
	@Transform(({ value }: { value: unknown }) => {
		const normalized = normalizeOptionalString(value)
		return normalized === undefined ? value : normalized.toUpperCase()
	})
	@IsIn(MAPPING_ACTIONS)
	action: MoySkladMappingAction

	@ApiPropertyOptional({
		type: String,
		description:
			'Existing Attribute id. If omitted, the attribute mapping is used.'
	})
	@IsOptional()
	@IsUUID()
	attributeId?: string

	@ApiPropertyOptional({
		type: String,
		description: 'Existing AttributeEnumValue id for LINK action'
	})
	@IsOptional()
	@IsUUID()
	enumValueId?: string

	@ApiPropertyOptional({
		type: String,
		description: 'Optional normalized value for CREATE action'
	})
	@Transform(({ value }: { value: unknown }) => normalizeOptionalString(value))
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	value?: string

	@ApiPropertyOptional({
		type: String,
		description: 'Optional display name for CREATE action'
	})
	@Transform(({ value }: { value: unknown }) => normalizeOptionalString(value))
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	displayName?: string
}

export class ApplyMoySkladMappingDtoReq {
	@ApiPropertyOptional({
		type: Boolean,
		description: 'Allows auto-creating unknown Attributes for a trusted catalog'
	})
	@IsOptional()
	@IsBoolean()
	trustedCatalog?: boolean

	@ApiPropertyOptional({ type: [ApplyMoySkladAttributeMappingDtoReq] })
	@IsOptional()
	@IsArray()
	@ArrayMaxSize(200)
	@ValidateNested({ each: true })
	@Type(() => ApplyMoySkladAttributeMappingDtoReq)
	attributes?: ApplyMoySkladAttributeMappingDtoReq[]

	@ApiPropertyOptional({ type: [ApplyMoySkladEnumValueMappingDtoReq] })
	@IsOptional()
	@IsArray()
	@ArrayMaxSize(1000)
	@ValidateNested({ each: true })
	@Type(() => ApplyMoySkladEnumValueMappingDtoReq)
	enumValues?: ApplyMoySkladEnumValueMappingDtoReq[]
}
