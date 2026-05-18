import type { Prisma } from '@generated/client'
import { AuditActorType, AuditOutcome, AuditSeverity } from '@generated/enums'
import { Injectable, Logger } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { getClientInfo } from '@/shared/http/utils/client-info'
import { RequestContext } from '@/shared/tenancy/request-context'

import type { AuthRequest, SessionUser } from '../auth/types/auth-request'

type AuditTargetInput = {
	targetType: string
	targetId?: string | null
	catalogId?: string | null
	label?: string | null
	snapshot?: Prisma.InputJsonValue | null
}

type AuditChangeInput = {
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

@Injectable()
export class AuditService {
	private readonly logger = new Logger(AuditService.name)

	constructor(private readonly prisma: PrismaService) {}

	async record(input: AuditRecordInput): Promise<void> {
		try {
			const context = RequestContext.get()
			const client = input.request ? getClientInfo(input.request) : null
			await this.prisma.auditEvent.create({
				data: {
					action: input.action,
					category: input.category ?? null,
					outcome: input.outcome ?? AuditOutcome.SUCCESS,
					severity: input.severity ?? AuditSeverity.INFO,
					actorType:
						input.actorType ??
						(input.actor ? AuditActorType.USER : AuditActorType.SYSTEM),
					actorId: input.actor?.id ?? null,
					actorUserId: input.actor?.id ?? null,
					actorRole: input.actor?.role ?? null,
					actorLogin: input.actor?.login ?? null,
					actorName: input.actor?.name ?? null,
					targetType: input.targetType ?? null,
					targetId: input.targetId ?? null,
					targetCatalogId: input.targetCatalogId ?? context?.catalogId ?? null,
					targetLabel: input.targetLabel ?? null,
					requestId: context?.requestId ?? null,
					host: context?.host ?? null,
					sessionId: input.request?.sessionId ?? null,
					ip: client?.ip ?? null,
					userAgent: client?.userAgent ?? null,
					method: input.request?.method ?? null,
					path: input.request?.originalUrl ?? input.request?.url ?? null,
					reason: input.reason ?? null,
					message: input.message ?? null,
					before: input.before ?? undefined,
					after: input.after ?? undefined,
					diff: input.diff ?? undefined,
					metadata: input.metadata ?? undefined,
					targets: input.targets?.length
						? {
								create: input.targets.map(target => ({
									targetType: target.targetType,
									targetId: target.targetId ?? null,
									catalogId: target.catalogId ?? input.targetCatalogId ?? null,
									label: target.label ?? null,
									snapshot: target.snapshot ?? undefined
								}))
							}
						: undefined,
					changes: input.changes?.length
						? {
								create: input.changes.map(change => ({
									field: change.field,
									oldValue: change.oldValue ?? undefined,
									newValue: change.newValue ?? undefined
								}))
							}
						: undefined
				}
			})
		} catch (error) {
			this.logger.warn('Failed to write audit event', {
				action: input.action,
				targetType: input.targetType,
				targetId: input.targetId,
				error: error instanceof Error ? error.message : String(error)
			})
		}
	}
}
