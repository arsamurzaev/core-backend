import { PrismaClient } from '@generated/client'
import {
	Injectable,
	Logger,
	OnModuleDestroy,
	OnModuleInit
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaPg } from '@prisma/adapter-pg'

import { AllInterfaces } from '@/core/config'

import {
	buildPrismaLogDefinitions,
	normalizePrismaQueryText,
	resolvePrismaSlowQuerySettings,
	type PrismaSlowQuerySettings
} from './prisma-observability'

@Injectable()
export class PrismaService
	extends PrismaClient
	implements OnModuleInit, OnModuleDestroy
{
	private readonly logger = new Logger(PrismaService.name)
	private readonly slowQuerySettings: PrismaSlowQuerySettings

	constructor(private readonly configService: ConfigService<AllInterfaces>) {
		const slowQuerySettings = resolvePrismaSlowQuerySettings()
		const adapter = new PrismaPg({
			user: configService.get('database.user', { infer: true }),
			password: configService.get('database.password', {
				infer: true
			}),
			host: configService.get('database.host', { infer: true }),
			port: configService.get('database.port', { infer: true }),
			database: configService.get('database.name', {
				infer: true
			})
		})

		super({
			adapter,
			log: buildPrismaLogDefinitions(slowQuerySettings)
		})

		this.slowQuerySettings = slowQuerySettings
		this.registerSlowQueryLogger()
	}

	async onModuleInit() {
		const start = Date.now()

		this.logger.log('Подключение к базе данных backend_auth...')

		try {
			await this.$connect()

			const ms = Date.now() - start
			this.logger.log(
				`Подключение к базе данных backend_auth успешно установлено за ${ms}мс`
			)
		} catch (error) {
			this.logger.error('Подключение к базе данных backend_auth не удалось', error)

			throw error
		}
	}

	async onModuleDestroy() {
		this.logger.log('Отключение от базы данных backend_auth...')
		try {
			await this.$disconnect()

			this.logger.log('Отключение от базы данных backend_auth успешно выполнено')
		} catch (error) {
			this.logger.error('Отключение от базы данных backend_auth не удалось', error)

			throw error
		}
	}

	private registerSlowQueryLogger() {
		if (this.slowQuerySettings.thresholdMs <= 0) return

		this.$on('query', event => {
			if (event.duration < this.slowQuerySettings.thresholdMs) {
				return
			}

			const target = event.target ? ` target=${event.target}` : ''
			const query = normalizePrismaQueryText(
				event.query,
				this.slowQuerySettings.maxQueryLength
			)

			this.logger.warn(
				`Slow Prisma query (${event.duration}ms${target}): ${query}`
			)
		})
	}
}
