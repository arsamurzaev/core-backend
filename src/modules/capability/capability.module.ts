import { Module } from '@nestjs/common'

import { PrismaModule } from '@/infrastructure/prisma/prisma.module'

import { CapabilityService } from './capability.service'
import { CAPABILITY_ASSERT_PORT, CAPABILITY_READER_PORT } from './contracts'
import { CapabilityGuard } from './guards/capability.guard'

@Module({
	imports: [PrismaModule],
	providers: [
		CapabilityService,
		CapabilityGuard,
		{ provide: CAPABILITY_READER_PORT, useExisting: CapabilityService },
		{ provide: CAPABILITY_ASSERT_PORT, useExisting: CapabilityService }
	],
	exports: [
		CapabilityService,
		CapabilityGuard,
		CAPABILITY_READER_PORT,
		CAPABILITY_ASSERT_PORT
	]
})
export class CapabilityModule {}
