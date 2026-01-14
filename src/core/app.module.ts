import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { TypeModule } from '@/modules/type/type.module'

import { PrismaModule } from '../infrastructure/prisma/prisma.module'

import { databaseEnv, httpEnv, redisEnv } from './config/env'

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
			load: [databaseEnv, redisEnv, httpEnv]
		}),
		PrismaModule,
		TypeModule
	]
})
export class AppModule {}
