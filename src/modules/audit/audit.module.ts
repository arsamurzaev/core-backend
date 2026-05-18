import { Global, Module } from '@nestjs/common'

import { AuditService } from './audit.service'
import { AUDIT_RECORDER_PORT } from './contracts'

@Global()
@Module({
	providers: [
		AuditService,
		{ provide: AUDIT_RECORDER_PORT, useExisting: AuditService }
	],
	exports: [AuditService, AUDIT_RECORDER_PORT]
})
export class AuditModule {}
