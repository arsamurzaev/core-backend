import { Global, Module } from '@nestjs/common'

import { PrismaService } from './prisma.service'

// Делаем модуль глобальным, чтобы не импортировать его каждый раз
@Global()
@Module({
	providers: [PrismaService],
	exports: [PrismaService] // Делаем сервис доступным для других модулей
})
export class PrismaModule {}
