import { Role } from '@generated/client'
import {
	Body,
	Controller,
	Delete,
	Get,
	MessageEvent,
	NotFoundException,
	Param,
	Post,
	Put,
	Query,
	Req,
	Res,
	Sse,
	UseGuards
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

import { Roles } from '@/modules/auth/decorators/roles.decorator'
import { User } from '@/modules/auth/decorators/user.decorator'
import { SessionGuard } from '@/modules/auth/guards/session.guard'
import type { SessionUser } from '@/modules/auth/types/auth-request'
import { AuthThrottle } from '@/shared/throttler/auth-throttle.decorator'
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
	CompleteCartOrderResponseDto,
	ShareCartResponseDto
} from './dto/responses/cart.dto.res'

const SSE_EXAMPLE = [
	'event: connected',
	'data: {"cartId":"0a7f0d75-4d82-4764-9fc4-3f2f11d5d955","timestamp":"2026-02-12T09:00:00.000Z"}',
	'',
	'event: ping',
	'data: {"timestamp":"2026-02-12T09:00:20.000Z"}',
	'',
	'event: cart.status_changed',
	'data: {"id":"0a7f0d75-4d82-4764-9fc4-3f2f11d5d955","status":"IN_PROGRESS"}',
	'',
	'event: cart.updated',
	'data: {"id":"0a7f0d75-4d82-4764-9fc4-3f2f11d5d955","items":[],"totals":{"itemsCount":0,"subtotal":0}}',
	''
].join('\n')

@ApiTags('Cart')
@Controller('cart')
export class CartController {
	constructor(private readonly cartService: CartService) {}

	@Post('current')
	@ApiOperation({
		summary: 'Create or return the current cart by cookie token'
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
	@ApiOperation({ summary: 'Get the current cart by cookie token' })
	@ApiOkResponse({ type: CartResponseDto })
	async getCurrent(
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response
	) {
		const token = this.readTokenFromRequest(req)
		const catalogId = mustCatalogId()
		try {
			const result = await this.cartService.getCurrentCartOrThrow(catalogId, token)
			return { ok: true, cart: result.cart }
		} catch (error) {
			if (this.isCartNotFoundError(error)) {
				this.clearTokenCookie(res)
			}

			throw error
		}
	}

	@Post('current/share')
	@ApiOperation({ summary: 'Issue a public key for the current cart' })
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
	@ApiOperation({ summary: 'Upsert an item in the current cart' })
	@ApiBody({
		type: UpsertCartItemDtoReq,
		examples: {
			base: {
				summary: 'Add two units of a product',
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
	@ApiOperation({ summary: 'Remove an item from the current cart' })
	@ApiParam({
		name: 'itemId',
		description: 'Cart item id',
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
		try {
			const result = await this.cartService.removeCurrentItem(
				catalogId,
				token,
				itemId
			)
			this.setTokenCookie(res, result.token)
			return { ok: true, cart: result.cart }
		} catch (error) {
			if (this.isCartNotFoundError(error)) {
				this.clearTokenCookie(res)
			}

			throw error
		}
	}

	@Sse('current/sse')
	@ApiOperation({ summary: 'SSE stream for the current cart' })
	@ApiProduces('text/event-stream')
	@ApiOkResponse({
		description: 'SSE events: connected, ping, cart.updated, cart.status_changed',
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
	@AuthThrottle()
	@ApiOperation({ summary: 'Issue a checkoutKey for a public cart' })
	@ApiParam({
		name: 'publicKey',
		description: 'Public cart key',
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
	@ApiOperation({ summary: 'Get a public cart by checkoutKey' })
	@ApiParam({
		name: 'publicKey',
		description: 'Public cart key',
		example: '5f7ec4ac9cc6c392419eec11850d45f1'
	})
	@ApiQuery({
		name: 'checkoutKey',
		required: true,
		description: 'Read/write key for the public cart'
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
	@Post('public/:publicKey/manager/start')
	@UseGuards(SessionGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Mark a cart as being processed by a manager' })
	@ApiParam({
		name: 'publicKey',
		description: 'Public cart key',
		example: '5f7ec4ac9cc6c392419eec11850d45f1'
	})
	@ApiOkResponse({ type: CartResponseDto })
	async startManagerSession(
		@Param('publicKey') publicKey: string,
		@User() user: SessionUser
	) {
		const cart = await this.cartService.beginManagerSession(publicKey, user)
		return { ok: true, cart }
	}

	@SkipCatalog()
	@Post('public/:publicKey/manager/heartbeat')
	@UseGuards(SessionGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Refresh manager presence for a cart' })
	@ApiParam({
		name: 'publicKey',
		description: 'Public cart key',
		example: '5f7ec4ac9cc6c392419eec11850d45f1'
	})
	@ApiOkResponse({ type: CartResponseDto })
	async heartbeatManagerSession(
		@Param('publicKey') publicKey: string,
		@User() user: SessionUser
	) {
		const cart = await this.cartService.heartbeatManagerSession(publicKey, user)
		return { ok: true, cart }
	}

	@SkipCatalog()
	@Post('public/:publicKey/manager/release')
	@UseGuards(SessionGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({
		summary: 'Move a cart to PAUSED after manager processing'
	})
	@ApiParam({
		name: 'publicKey',
		description: 'Public cart key',
		example: '5f7ec4ac9cc6c392419eec11850d45f1'
	})
	@ApiOkResponse({ type: CartResponseDto })
	async releaseManagerSession(
		@Param('publicKey') publicKey: string,
		@User() user: SessionUser
	) {
		const cart = await this.cartService.releaseManagerSession(publicKey, user)
		return { ok: true, cart }
	}

	@SkipCatalog()
	@Post('public/:publicKey/manager/complete')
	@UseGuards(SessionGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({
		summary: 'Convert a shared cart to a completed order'
	})
	@ApiParam({
		name: 'publicKey',
		description: 'Public cart key',
		example: '5f7ec4ac9cc6c392419eec11850d45f1'
	})
	@ApiOkResponse({ type: CompleteCartOrderResponseDto })
	async completeManagerOrder(
		@Param('publicKey') publicKey: string,
		@User() user: SessionUser
	) {
		const result = await this.cartService.completeManagerOrder(publicKey, user)
		return { ok: true, order: result.order }
	}

	@SkipCatalog()
	@Put('public/:publicKey/items')
	@ApiOperation({ summary: 'Upsert an item in a public cart' })
	@ApiParam({
		name: 'publicKey',
		description: 'Public cart key',
		example: '5f7ec4ac9cc6c392419eec11850d45f1'
	})
	@ApiBody({
		type: PublicUpsertCartItemDtoReq,
		examples: {
			base: {
				summary: 'Add a product to the public cart',
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
	@ApiOperation({ summary: 'Remove an item from a public cart' })
	@ApiParam({
		name: 'publicKey',
		description: 'Public cart key',
		example: '5f7ec4ac9cc6c392419eec11850d45f1'
	})
	@ApiParam({
		name: 'itemId',
		description: 'Cart item id',
		example: 'fc31fd15-6f7e-4fb1-a594-34fa14f6ef0c'
	})
	@ApiQuery({
		name: 'checkoutKey',
		required: true,
		description: 'Write key for the public cart'
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
	@ApiOperation({ summary: 'SSE stream for a public cart' })
	@ApiParam({
		name: 'publicKey',
		description: 'Public cart key',
		example: '5f7ec4ac9cc6c392419eec11850d45f1'
	})
	@ApiQuery({
		name: 'checkoutKey',
		required: true,
		description: 'SSE access key for the public cart'
	})
	@ApiProduces('text/event-stream')
	@ApiOkResponse({
		description: 'SSE events: connected, ping, cart.updated, cart.status_changed',
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

	private clearTokenCookie(res: Response) {
		res.clearCookie(this.cartService.getCookieName(), {
			httpOnly: true,
			sameSite: 'lax',
			path: '/'
		})
	}

	private isCartNotFoundError(error: unknown) {
		if (!(error instanceof NotFoundException)) {
			return false
		}

		const response = error.getResponse()
		if (typeof response === 'string') {
			return response === 'Корзина не найдена'
		}

		if (
			typeof response === 'object' &&
			response !== null &&
			'message' in response
		) {
			const message = response.message
			if (Array.isArray(message)) {
				return message.includes('Корзина не найдена')
			}

			return message === 'Корзина не найдена'
		}

		return error.message === 'Корзина не найдена'
	}
}
