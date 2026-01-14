import { Module } from '@nestjs/common'

import { TypeController } from './type.controller'
import { TypeRepository } from './type.repository'
import { TypeService } from './type.service'

@Module({
	controllers: [TypeController],
	providers: [TypeService, TypeRepository]
})
export class TypeModule {}
