import { Module } from '@nestjs/common'

import { MediaUrlService } from '@/shared/media/media-url.service'

import { CartController } from './cart.controller'
import { CartService } from './cart.service'

@Module({
	controllers: [CartController],
	providers: [CartService, MediaUrlService]
})
export class CartModule {}
