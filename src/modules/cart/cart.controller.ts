import {
	Body,
	Controller,
	Delete,
	Get,
	MessageEvent,
	Param,
	Post,
	Put,
	Query,
	Req,
	Res,
	Sse
} from '@nestjs/common'
import {
	ApiBody,
	ApiCreatedResponse,
	ApiOkResponse,
	ApiOperation,
	ApiParam,
	ApiProduces,
	ApiQuery,
	ApiTags
} from '@nestjs/swagger'
import type { Request, Response } from 'express'
import type { Observable } from 'rxjs'

import { mustCatalogId } from '@/shared/tenancy/ctx'
import { SkipCatalog } from '@/shared/tenancy/decorators/skip-catalog.decorator'

import { CartService } from './cart.service'
import {
	PublicUpsertCartItemDtoReq,
	UpsertCartItemDtoReq
} from './dto/requests/upsert-cart-item.dto.req'
import {
	CartResponseDto,
	CheckoutCartResponseDto,
	ShareCartResponseDto
} from './dto/responses/cart.dto.res'

const SSE_EXAMPLE = [
	'event: connected',
	'data: {"cartId":"0a7f0d75-4d82-4764-9fc4-3f2f11d5d955","timestamp":"2026-02-12T09:00:00.000Z"}',
	'',
	'event: ping',
	'data: {"timestamp":"2026-02-12T09:00:20.000Z"}',
	'',
	'event: cart.updated',
	'data: {"id":"0a7f0d75-4d82-4764-9fc4-3f2f11d5d955","items":[],"totals":{"itemsCount":0,"subtotal":0}}',
	''
].join('\n')

@ApiTags('Корзина')
@Controller('cart')
export class CartController {
	constructor(private readonly cartService: CartService) {}

	@Post('current')
	@ApiOperation({
		summary: 'Создать или получить текущую корзину по cookie-токену'
	})
	@ApiCreatedResponse({ type: CartResponseDto })
	async createOrGetCurrent(
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response
	) {
		const token = this.readTokenFromRequest(req)
		const catalogId = mustCatalogId()
		const result = await this.cartService.getOrCreateCurrentCart(catalogId, token)
		this.setTokenCookie(res, result.token)
		return { ok: true, cart: result.cart }
	}

	@Get('current')
	@ApiOperation({ summary: 'Получить текущую корзину по cookie-токену' })
	@ApiOkResponse({ type: CartResponseDto })
	async getCurrent(@Req() req: Request) {
		const token = this.readTokenFromRequest(req)
		const catalogId = mustCatalogId()
		const result = await this.cartService.getCurrentCartOrThrow(catalogId, token)
		return { ok: true, cart: result.cart }
	}

	@Post('current/share')
	@ApiOperation({ summary: 'Получить публичный ключ для шаринга корзины' })
	@ApiOkResponse({ type: ShareCartResponseDto })
	async shareCurrent(
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response
	) {
		const token = this.readTokenFromRequest(req)
		const catalogId = mustCatalogId()
		const result = await this.cartService.shareCurrentCart(catalogId, token)
		this.setTokenCookie(res, result.token)
		return {
			ok: true,
			publicKey: result.cart.publicKey,
			cart: result.cart
		}
	}

	@Put('current/items')
	@ApiOperation({ summary: 'Добавить или обновить позицию в текущей корзине' })
	@ApiBody({
		type: UpsertCartItemDtoReq,
		examples: {
			base: {
				summary: 'Добавить 2 шт товара',
				value: {
					productId: 'd084ec3f-55cb-4ba4-9f50-c18fd01ea124',
					variantId: '9f3f4ec2-9f74-4e03-b8cf-95ce5449cb8e',
					quantity: 2
				}
			}
		}
	})
	@ApiOkResponse({ type: CartResponseDto })
	async upsertCurrentItem(
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response,
		@Body() dto: UpsertCartItemDtoReq
	) {
		const token = this.readTokenFromRequest(req)
		const catalogId = mustCatalogId()
		const result = await this.cartService.upsertCurrentItem(catalogId, token, dto)
		this.setTokenCookie(res, result.token)
		return { ok: true, cart: result.cart }
	}

	@Delete('current/items/:itemId')
	@ApiOperation({ summary: 'Удалить позицию из текущей корзины' })
	@ApiParam({
		name: 'itemId',
		description: 'ID позиции корзины',
		example: 'fc31fd15-6f7e-4fb1-a594-34fa14f6ef0c'
	})
	@ApiOkResponse({ type: CartResponseDto })
	async removeCurrentItem(
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response,
		@Param('itemId') itemId: string
	) {
		const token = this.readTokenFromRequest(req)
		const catalogId = mustCatalogId()
		const result = await this.cartService.removeCurrentItem(
			catalogId,
			token,
			itemId
		)
		this.setTokenCookie(res, result.token)
		return { ok: true, cart: result.cart }
	}

	@Sse('current/sse')
	@ApiOperation({ summary: 'SSE поток обновлений текущей корзины' })
	@ApiProduces('text/event-stream')
	@ApiOkResponse({
		description: 'SSE события: connected, ping, cart.updated',
		content: {
			'text/event-stream': {
				schema: { type: 'string', example: SSE_EXAMPLE }
			}
		}
	})
	async sseCurrent(
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response
	): Promise<Observable<MessageEvent>> {
		const token = this.readTokenFromRequest(req)
		const catalogId = mustCatalogId()
		const result = await this.cartService.connectCurrentSse(catalogId, token)
		this.setTokenCookie(res, result.token)
		return result.stream
	}

	@SkipCatalog()
	@Post('public/:publicKey/checkout')
	@ApiOperation({ summary: 'Выдать checkoutKey для публичной корзины' })
	@ApiParam({
		name: 'publicKey',
		description: 'Публичный ключ корзины',
		example: '5f7ec4ac9cc6c392419eec11850d45f1'
	})
	@ApiOkResponse({ type: CheckoutCartResponseDto })
	async createCheckoutKey(@Param('publicKey') publicKey: string) {
		const result = await this.cartService.issueCheckoutKey(publicKey)
		return {
			ok: true,
			publicKey: result.cart.publicKey,
			checkoutKey: result.checkoutKey,
			cart: result.cart
		}
	}

	@SkipCatalog()
	@Get('public/:publicKey')
	@ApiOperation({ summary: 'Получить публичную корзину по checkoutKey' })
	@ApiParam({
		name: 'publicKey',
		description: 'Публичный ключ корзины',
		example: '5f7ec4ac9cc6c392419eec11850d45f1'
	})
	@ApiQuery({
		name: 'checkoutKey',
		required: true,
		description: 'Ключ доступа для чтения/изменения публичной корзины'
	})
	@ApiOkResponse({ type: CartResponseDto })
	async getPublicCart(
		@Param('publicKey') publicKey: string,
		@Query('checkoutKey') checkoutKey?: string
	) {
		const cart = await this.cartService.getPublicCart(publicKey, checkoutKey)
		return { ok: true, cart }
	}

	@SkipCatalog()
	@Put('public/:publicKey/items')
	@ApiOperation({ summary: 'Добавить или обновить позицию в публичной корзине' })
	@ApiParam({
		name: 'publicKey',
		description: 'Публичный ключ корзины',
		example: '5f7ec4ac9cc6c392419eec11850d45f1'
	})
	@ApiBody({
		type: PublicUpsertCartItemDtoReq,
		examples: {
			base: {
				summary: 'Добавить товар в публичную корзину',
				value: {
					checkoutKey: '7b5f8d06f87d14d4a4f1f3f9826459fd9f9a',
					productId: 'd084ec3f-55cb-4ba4-9f50-c18fd01ea124',
					variantId: '9f3f4ec2-9f74-4e03-b8cf-95ce5449cb8e',
					quantity: 2
				}
			}
		}
	})
	@ApiOkResponse({ type: CartResponseDto })
	async upsertPublicItem(
		@Param('publicKey') publicKey: string,
		@Body() dto: PublicUpsertCartItemDtoReq
	) {
		const cart = await this.cartService.upsertPublicItem(
			publicKey,
			dto.checkoutKey,
			dto
		)
		return { ok: true, cart }
	}

	@SkipCatalog()
	@Delete('public/:publicKey/items/:itemId')
	@ApiOperation({ summary: 'Удалить позицию из публичной корзины' })
	@ApiParam({
		name: 'publicKey',
		description: 'Публичный ключ корзины',
		example: '5f7ec4ac9cc6c392419eec11850d45f1'
	})
	@ApiParam({
		name: 'itemId',
		description: 'ID позиции корзины',
		example: 'fc31fd15-6f7e-4fb1-a594-34fa14f6ef0c'
	})
	@ApiQuery({
		name: 'checkoutKey',
		required: true,
		description: 'Ключ доступа для изменения публичной корзины'
	})
	@ApiOkResponse({ type: CartResponseDto })
	async removePublicItem(
		@Param('publicKey') publicKey: string,
		@Param('itemId') itemId: string,
		@Query('checkoutKey') checkoutKey?: string
	) {
		const cart = await this.cartService.removePublicItem(
			publicKey,
			checkoutKey,
			itemId
		)
		return { ok: true, cart }
	}

	@SkipCatalog()
	@Sse('public/:publicKey/sse')
	@ApiOperation({ summary: 'SSE поток обновлений публичной корзины' })
	@ApiParam({
		name: 'publicKey',
		description: 'Публичный ключ корзины',
		example: '5f7ec4ac9cc6c392419eec11850d45f1'
	})
	@ApiQuery({
		name: 'checkoutKey',
		required: true,
		description: 'Ключ доступа для подписки на SSE'
	})
	@ApiProduces('text/event-stream')
	@ApiOkResponse({
		description: 'SSE события: connected, ping, cart.updated',
		content: {
			'text/event-stream': {
				schema: { type: 'string', example: SSE_EXAMPLE }
			}
		}
	})
	async ssePublic(
		@Param('publicKey') publicKey: string,
		@Query('checkoutKey') checkoutKey?: string
	): Promise<Observable<MessageEvent>> {
		return this.cartService.connectPublicSse(publicKey, checkoutKey)
	}

	private readTokenFromRequest(req: Request) {
		return this.cartService.readTokenFromCookie(req.headers.cookie)
	}

	private setTokenCookie(res: Response, token: string) {
		res.cookie(this.cartService.getCookieName(), token, {
			httpOnly: true,
			sameSite: 'lax',
			path: '/'
		})
	}
}
