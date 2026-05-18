import type { AuditRecordInput } from './audit.service'

export const AUDIT_RECORDER_PORT = Symbol('AUDIT_RECORDER_PORT')

export interface AuditRecorderPort {
	record(input: AuditRecordInput): Promise<void>
}
