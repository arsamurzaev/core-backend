import type { Prisma } from '@generated/client'
import type {
	AuditActorType,
	AuditOutcome,
	AuditSeverity
} from '@generated/enums'

import type { AuthRequest, SessionUser } from '../auth/types/auth-request'

export const AUDIT_RECORDER_PORT = Symbol('AUDIT_RECORDER_PORT')

export type AuditTargetInput = {
	targetType: string
	targetId?: string | null
	catalogId?: string | null
	label?: string | null
	snapshot?: Prisma.InputJsonValue | null
}

export type AuditChangeInput = {
	field: string
	oldValue?: Prisma.InputJsonValue | null
	newValue?: Prisma.InputJsonValue | null
}

export type AuditRecordInput = {
	action: string
	category?: string | null
	outcome?: AuditOutcome
	severity?: AuditSeverity
	actor?: SessionUser | null
	actorType?: AuditActorType
	request?: AuthRequest | null
	targetType?: string | null
	targetId?: string | null
	targetCatalogId?: string | null
	targetLabel?: string | null
	reason?: string | null
	message?: string | null
	before?: Prisma.InputJsonValue | null
	after?: Prisma.InputJsonValue | null
	diff?: Prisma.InputJsonValue | null
	metadata?: Prisma.InputJsonValue | null
	targets?: AuditTargetInput[]
	changes?: AuditChangeInput[]
}

export interface AuditRecorderPort {
	record(input: AuditRecordInput): Promise<void>
}
