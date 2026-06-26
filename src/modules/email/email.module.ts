import { Module } from '@nestjs/common'

import { EMAIL_SENDER_PORT } from './contracts'
import { EmailService } from './email.service'

@Module({
	providers: [
		EmailService,
		{
			provide: EMAIL_SENDER_PORT,
			useExisting: EmailService
		}
	],
	exports: [EMAIL_SENDER_PORT]
})
export class EmailModule {}
