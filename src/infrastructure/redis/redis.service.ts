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
			maxLoadingRetryTime: 5,
			enableOfflineQueue: true
		})
	}

	onModuleInit() {
		const start = Date.now()

		this.logger.log('Подключение к Redis...')

		this.on('connect', () => {
			this.logger.log('Подключение к Redis успешно установлено')
		})

		this.on('ready', () => {
			const ms = Date.now() - start
			this.logger.log(`Подключение к Redis успешно установлено за ${ms}мс`)
		})

		this.on('error', error => {
			this.logger.error('Подключение к Redis не удалось', {
				error: error.message ?? error
			})
		})

		this.on('close', () => {
			this.logger.warn('Подключение к Redis закрыто')
		})

		this.on('reconnecting', () => {
			this.logger.warn('Подключение к Redis переподключается')
		})
	}

	async onModuleDestroy() {
		this.logger.log('Отключение от Redis...')

		try {
			await this.quit()

			this.logger.log('Отключение от Redis успешно выполнено')
		} catch (error) {
			this.on('error', error => {
				this.logger.error('Отключение от Redis не удалось', {
					error: error.message ?? error
				})
			})
		}
	}
}
