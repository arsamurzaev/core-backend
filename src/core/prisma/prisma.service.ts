import { Injectable, OnModuleInit } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '@/generated/client'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
	constructor() {
		const pool = new PrismaPg({
			connectionString: process.env.DATABASE_URL!
		})
		super({ adapter: pool })
	}
	async onModuleInit() {
		// Note: this is optional
		await this.$connect()
	}
}
