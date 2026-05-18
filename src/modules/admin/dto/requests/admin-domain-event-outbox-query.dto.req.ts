import { DomainEventOutboxStatus } from '@generated/enums'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
	IsEnum,
	IsInt,
	IsOptional,
	IsString,
	IsUUID,
	Max,
	Min
} from 'class-validator'

export class AdminDomainEventOutboxQueryDtoReq {
	@ApiPropertyOptional({ enum: DomainEventOutboxStatus })
	@IsOptional()
	@IsEnum(DomainEventOutboxStatus)
	status?: DomainEventOutboxStatus

	@ApiPropertyOptional({ type: String, format: 'uuid' })
	@IsOptional()
	@IsUUID()
	catalogId?: string

	@ApiPropertyOptional({ type: String })
	@IsOptional()
	@IsString()
	eventType?: string

	@ApiPropertyOptional({ type: String })
	@IsOptional()
	@IsString()
	aggregateType?: string

	@ApiPropertyOptional({ type: String })
	@IsOptional()
	@IsString()
	aggregateId?: string

	@ApiPropertyOptional({ type: Number, default: 50, maximum: 200 })
	@Type(() => Number)
	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(200)
	limit?: number
}

export class AdminRetryFailedDomainEventsDtoReq {
	@ApiPropertyOptional({ type: String, format: 'uuid' })
	@IsOptional()
	@IsUUID()
	catalogId?: string

	@ApiPropertyOptional({ type: String })
	@IsOptional()
	@IsString()
	eventType?: string

	@ApiPropertyOptional({ type: Number, default: 50, maximum: 500 })
	@Type(() => Number)
	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(500)
	limit?: number
}

export class AdminDrainDomainEventOutboxDtoReq {
	@ApiPropertyOptional({ type: Number, default: 100, maximum: 500 })
	@Type(() => Number)
	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(500)
	limit?: number

	@ApiPropertyOptional({ type: Number, default: 5, maximum: 50 })
	@Type(() => Number)
	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(50)
	maxAttempts?: number

	@ApiPropertyOptional({ type: Number, default: 300000 })
	@Type(() => Number)
	@IsOptional()
	@IsInt()
	@Min(1000)
	staleProcessingMs?: number
}

export class AdminCleanupDomainEventOutboxDtoReq {
	@ApiPropertyOptional({ type: Number, default: 30 })
	@Type(() => Number)
	@IsOptional()
	@IsInt()
	@Min(1)
	retentionDays?: number

	@ApiPropertyOptional({ type: Number, default: 5000, maximum: 50000 })
	@Type(() => Number)
	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(50000)
	limit?: number
}
