import {
	Injectable,
	Logger,
	type OnModuleDestroy,
	type OnModuleInit
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

import { AllInterfaces } from '@/core/config'

@Injectable()
export class RedisService
	extends Redis
	implements OnModuleInit, OnModuleDestroy
{
	private readonly logger = new Logger(RedisService.name)

	constructor(private readonly configService: ConfigService<AllInterfaces>) {
		super({
			username: configService.get<string>('redis.user', { infer: true }),
			password: configService.get<string>('redis.password', {
				infer: true
			}),
			host: configService.get<string>('redis.host', { infer: true }),
			port: configService.get('redis.port', { infer: true }),
			commandTimeout: 5000,
			connectTimeout: 10000,
			maxLoadingRetryTime: 5000,
			enableOfflineQueue: true,
			retryStrategy: times => Math.min(times * 500, 5000)
		})
	}

	async onModuleInit() {
		const start = Date.now()

		this.logger.log('Подключение к Redis...')

		this.on('connect', () => {
			this.logger.log('Подключение к Redis успешно установлено')
		})

		this.on('ready', () => {
			const ms = Date.now() - start
			this.logger.log(`Redis готов за ${ms}мс`)
		})

		this.on('error', error => {
			this.logger.error('Ошибка подключения к Redis', {
				error: error.message ?? error
			})
		})

		this.on('close', () => {
			this.logger.warn('Подключение к Redis закрыто')
		})

		this.on('reconnecting', () => {
			this.logger.warn('Redis переподключается...')
		})

		try {
			await this.ping()
			this.logger.log('Redis ping успешен')
		} catch (error) {
			this.logger.error('Redis недоступен при старте приложения', {
				error: error instanceof Error ? error.message : String(error)
			})
			throw error
		}
	}

	async onModuleDestroy() {
		this.logger.log('Отключение от Redis...')

		try {
			await this.quit()

			this.logger.log('Отключение от Redis успешно выполнено')
		} catch (error) {
			this.logger.error('Отключение от Redis не удалось', {
				error: error instanceof Error ? error.message : String(error)
			})
		}
	}
}
