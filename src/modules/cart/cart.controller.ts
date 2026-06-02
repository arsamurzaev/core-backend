import { Role } from '@generated/client'
import {
	Body,
	Controller,
	Delete,
	Get,
	Headers,
	HttpCode,
	MessageEvent,
	NotFoundException,
	Param,
	Post,
	Put,
	Req,
	Res,
	Sse,
	UseGuards
} from '@nestjs/common'
import {
	ApiBody,
	ApiCreatedResponse,
	ApiHeader,
	ApiNoContentResponse,
	ApiOkResponse,
	ApiOperation,
	ApiParam,
	ApiProduces,
	ApiTags
} from '@nestjs/swagger'
import type { Request, Response } from 'express'
import type { Observable } from 'rxjs'

import { Roles } from '@/modules/auth/decorators/roles.decorator'
import { User } from '@/modules/auth/decorators/user.decorator'
import { SessionGuard } from '@/modules/auth/guards/session.guard'
import type { SessionUser } from '@/modules/auth/types/auth-request'
import { setPrivateNoStoreHeaders } from '@/shared/http/cache-control'
import {
	resolveCookieDomain,
	resolveServerHost
} from '@/shared/http/cookie.utils'
import { mustCatalogId } from '@/shared/tenancy/ctx'
import { SkipCatalog } from '@/shared/tenancy/decorators/skip-catalog.decorator'

import { CartService } from './cart.service'
import { CART_GUEST_TOKEN_HEADER } from './cart.utils'
import {
	JoinHallTableSessionDtoReq,
	PublicUpsertCartItemDtoReq,
	ShareCurrentCartDtoReq,
	UpsertCartItemDtoReq
} from './dto/requests/upsert-cart-item.dto.req'
import {
	CartResponseDto,
	CompleteCartOrderResponseDto,
	HallTableLinkResponseDto,
	HallTableOverviewResponseDto,
	HallTableSessionResponseDto,
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
		this.setTokenCookie(req, res, result.token)
		return { ok: true, cart: result.cart }
	}

	@Get('current')
	@ApiOperation({ summary: 'Get the current cart by cookie token' })
	@ApiOkResponse({ type: CartResponseDto })
	async getCurrent(
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response
	) {
		setPrivateNoStoreHeaders(res)
		const token = this.readTokenFromRequest(req)
		const catalogId = mustCatalogId()
		try {
			const result = await this.cartService.getCurrentCartOrThrow(catalogId, token)
			return { ok: true, cart: result.cart }
		} catch (error) {
			if (this.isCartNotFoundError(error)) {
				this.clearTokenCookie(req, res)
			}

			throw error
		}
	}

	@Delete('current')
	@HttpCode(204)
	@ApiOperation({
		summary: 'Delete or detach the current cart by cookie token'
	})
	@ApiNoContentResponse({
		description:
			'Current cart was deleted, or detached when it is already assigned to a manager'
	})
	async deleteCurrent(
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response
	) {
		const token = this.readTokenFromRequest(req)
		const catalogId = mustCatalogId()
		try {
			await this.cartService.deleteCurrentCart(catalogId, token)
			this.clearTokenCookie(req, res)
		} catch (error) {
			if (this.isCartNotFoundError(error)) {
				this.clearTokenCookie(req, res)
			}

			throw error
		}
	}

	@Post('current/share')
	@ApiOperation({ summary: 'Issue a public key for the current cart' })
	@ApiBody({ type: ShareCurrentCartDtoReq, required: false })
	@ApiOkResponse({ type: ShareCartResponseDto })
	async shareCurrent(
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response,
		@Body() dto: ShareCurrentCartDtoReq = {}
	) {
		const token = this.readTokenFromRequest(req)
		const catalogId = mustCatalogId()
		const result = await this.cartService.shareCurrentCart(catalogId, token, {
			checkoutData: dto.checkoutData,
			checkoutMethod: dto.checkoutMethod,
			comment: dto.comment
		})
		this.setTokenCookie(req, res, result.token)
		return {
			ok: true,
			publicKey: result.cart.publicKey,
			cart: result.cart
		}
	}

	@Post('current/hall-order')
	@ApiOperation({ summary: 'Submit the current cart as a hall table order' })
	@ApiBody({ type: ShareCurrentCartDtoReq, required: false })
	@ApiOkResponse({ type: CompleteCartOrderResponseDto })
	async submitCurrentHallOrder(
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response,
		@Body() dto: ShareCurrentCartDtoReq = {}
	) {
		const token = this.readTokenFromRequest(req)
		const catalogId = mustCatalogId()
		const result = await this.cartService.submitCurrentHallOrder(
			catalogId,
			token,
			{
				checkoutData: dto.checkoutData,
				checkoutMethod: dto.checkoutMethod,
				comment: dto.comment
			}
		)
		this.setTokenCookie(req, res, result.token)
		return { ok: true, order: result.order }
	}

	@Get('hall-table/:code')
	@ApiOperation({ summary: 'Resolve a short hall table code for display' })
	@ApiParam({
		name: 'code',
		description: 'Short backend-stored hall table code',
		example: 'Ab7Kp92x'
	})
	@ApiOkResponse({ type: HallTableLinkResponseDto })
	async getHallTableLink(@Param('code') code: string) {
		const catalogId = mustCatalogId()
		const table = await this.cartService.getHallTableLink(catalogId, code)
		return { ok: true, table }
	}

	@Get('hall-tables')
	@UseGuards(SessionGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'List iiko hall tables with active cart sessions' })
	@ApiOkResponse({ type: HallTableOverviewResponseDto })
	async listHallTables() {
		const catalogId = mustCatalogId()
		const tables = await this.cartService.listHallTables(catalogId)
		return { ok: true, tables }
	}

	@Post('hall-table/:code/session')
	@ApiOperation({
		summary: 'Create or return a shared cart session for a hall table'
	})
	@ApiParam({
		name: 'code',
		description: 'Short backend-stored hall table code',
		example: 'Ab7Kp92x'
	})
	@ApiBody({ type: JoinHallTableSessionDtoReq, required: false })
	@ApiOkResponse({ type: HallTableSessionResponseDto })
	async joinHallTableSession(
		@Param('code') code: string,
		@Body() dto: JoinHallTableSessionDtoReq = {}
	) {
		const catalogId = mustCatalogId()
		const tableSession = await this.cartService.joinHallTableSession(
			catalogId,
			code,
			dto
		)
		return { ok: true, tableSession }
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
		this.setTokenCookie(req, res, result.token)
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
			this.setTokenCookie(req, res, result.token)
			return { ok: true, cart: result.cart }
		} catch (error) {
			if (this.isCartNotFoundError(error)) {
				this.clearTokenCookie(req, res)
			}

			throw error
		}
	}

	@Sse('current/sse')
	@ApiOperation({ summary: 'SSE stream for the current cart' })
	@ApiProduces('text/event-stream')
	@ApiHeader({
		name: 'Last-Event-ID',
		required: false,
		description: 'Last received Redis Stream event id for SSE replay'
	})
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
		@Headers('last-event-id') lastEventId?: string
	): Promise<Observable<MessageEvent>> {
		const token = this.readTokenFromRequest(req)
		const catalogId = mustCatalogId()
		return this.cartService.connectCurrentSse(catalogId, token, lastEventId)
	}

	@SkipCatalog()
	@Get('public/:publicKey')
	@ApiOperation({ summary: 'Get a public cart by public key' })
	@ApiParam({
		name: 'publicKey',
		description: 'Public cart key',
		example: '5f7ec4ac9cc6c392419eec11850d45f1'
	})
	@ApiOkResponse({ type: CartResponseDto })
	async getPublicCart(
		@Param('publicKey') publicKey: string,
		@Res({ passthrough: true }) res: Response
	) {
		setPrivateNoStoreHeaders(res)
		const cart = await this.cartService.getPublicCart(publicKey)
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
	@ApiBody({ type: ShareCurrentCartDtoReq, required: false })
	@ApiOkResponse({ type: CompleteCartOrderResponseDto })
	async completeManagerOrder(
		@Param('publicKey') publicKey: string,
		@User() user: SessionUser,
		@Body() dto: ShareCurrentCartDtoReq = {}
	) {
		const result = await this.cartService.completeManagerOrder(publicKey, user, {
			checkoutData: dto.checkoutData,
			checkoutMethod: dto.checkoutMethod,
			comment: dto.comment
		})
		return { ok: true, order: result.order }
	}

	@SkipCatalog()
	@Post('public/:publicKey/hall-table/close')
	@UseGuards(SessionGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({
		summary: 'Close an open shared hall table cart'
	})
	@ApiParam({
		name: 'publicKey',
		description: 'Public cart key',
		example: '5f7ec4ac9cc6c392419eec11850d45f1'
	})
	@ApiOkResponse({ type: CartResponseDto })
	async closeHallTableSession(
		@Param('publicKey') publicKey: string,
		@User() user: SessionUser
	) {
		const cart = await this.cartService.closeHallTableSession(publicKey, user)
		return { ok: true, cart }
	}

	@SkipCatalog()
	@Post('public/:publicKey/hall-table/reset')
	@UseGuards(SessionGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({
		summary: 'Reset an open shared hall table cart'
	})
	@ApiParam({
		name: 'publicKey',
		description: 'Public cart key',
		example: '5f7ec4ac9cc6c392419eec11850d45f1'
	})
	@ApiOkResponse({ type: CartResponseDto })
	async resetHallTableSession(
		@Param('publicKey') publicKey: string,
		@User() user: SessionUser
	) {
		const cart = await this.cartService.resetHallTableSession(publicKey, user)
		return { ok: true, cart }
	}

	@SkipCatalog()
	@Post('public/:publicKey/hall-table/confirm')
	@UseGuards(SessionGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({
		summary: 'Confirm a shared hall table cart and send it to iiko'
	})
	@ApiParam({
		name: 'publicKey',
		description: 'Public cart key',
		example: '5f7ec4ac9cc6c392419eec11850d45f1'
	})
	@ApiBody({ type: ShareCurrentCartDtoReq, required: false })
	@ApiOkResponse({ type: CompleteCartOrderResponseDto })
	async confirmHallTableOrder(
		@Param('publicKey') publicKey: string,
		@User() user: SessionUser,
		@Body() dto: ShareCurrentCartDtoReq = {}
	) {
		const result = await this.cartService.confirmHallTableOrder(publicKey, user, {
			checkoutData: dto.checkoutData,
			checkoutMethod: dto.checkoutMethod,
			comment: dto.comment
		})
		return { ok: true, order: result.order }
	}

	@SkipCatalog()
	@Post('public/:publicKey/hall-order')
	@ApiOperation({
		summary: 'Send a public shared hall table cart to waiter confirmation'
	})
	@ApiHeader({
		name: CART_GUEST_TOKEN_HEADER,
		required: false,
		description: 'Required for hall table guest actions'
	})
	@ApiParam({
		name: 'publicKey',
		description: 'Public cart key',
		example: '5f7ec4ac9cc6c392419eec11850d45f1'
	})
	@ApiBody({ type: ShareCurrentCartDtoReq, required: false })
	@ApiOkResponse({ type: CartResponseDto })
	async submitPublicHallOrder(
		@Param('publicKey') publicKey: string,
		@Headers(CART_GUEST_TOKEN_HEADER) guestToken: string | undefined,
		@Body() dto: ShareCurrentCartDtoReq = {}
	) {
		const result = await this.cartService.submitPublicHallOrder(
			publicKey,
			{
				checkoutData: dto.checkoutData,
				checkoutMethod: dto.checkoutMethod,
				comment: dto.comment
			},
			guestToken
		)
		return { ok: true, cart: result.cart }
	}

	@SkipCatalog()
	@Put('public/:publicKey/items')
	@ApiOperation({ summary: 'Upsert an item in a public cart' })
	@ApiHeader({
		name: CART_GUEST_TOKEN_HEADER,
		required: false,
		description: 'Required for hall table guest actions'
	})
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
		@Headers(CART_GUEST_TOKEN_HEADER) guestToken: string | undefined,
		@Body() dto: PublicUpsertCartItemDtoReq
	) {
		const cart = await this.cartService.upsertPublicItem(
			publicKey,
			dto,
			guestToken
		)
		return { ok: true, cart }
	}

	@SkipCatalog()
	@Delete('public/:publicKey/items/:itemId')
	@ApiOperation({ summary: 'Remove an item from a public cart' })
	@ApiHeader({
		name: CART_GUEST_TOKEN_HEADER,
		required: false,
		description: 'Required for hall table guest actions'
	})
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
	@ApiOkResponse({ type: CartResponseDto })
	async removePublicItem(
		@Param('publicKey') publicKey: string,
		@Headers(CART_GUEST_TOKEN_HEADER) guestToken: string | undefined,
		@Param('itemId') itemId: string
	) {
		const cart = await this.cartService.removePublicItem(
			publicKey,
			itemId,
			guestToken
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
	@ApiHeader({
		name: 'Last-Event-ID',
		required: false,
		description: 'Last received Redis Stream event id for SSE replay'
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
		@Headers('last-event-id') lastEventId?: string
	): Promise<Observable<MessageEvent>> {
		return this.cartService.connectPublicSse(publicKey, lastEventId)
	}

	private readTokenFromRequest(req: Request) {
		return this.cartService.readTokenFromCookie(req.headers.cookie)
	}

	private setTokenCookie(req: Request, res: Response, token: string) {
		const cookieDomain = resolveCookieDomain(resolveServerHost(req))
		res.cookie(this.cartService.getCookieName(), token, {
			httpOnly: true,
			sameSite: 'lax',
			secure: process.env.NODE_ENV === 'production',
			path: '/',
			...(cookieDomain ? { domain: cookieDomain } : {})
		})
	}

	private clearTokenCookie(req: Request, res: Response) {
		const cookieDomain = resolveCookieDomain(resolveServerHost(req))
		res.clearCookie(this.cartService.getCookieName(), {
			httpOnly: true,
			sameSite: 'lax',
			secure: process.env.NODE_ENV === 'production',
			path: '/',
			...(cookieDomain ? { domain: cookieDomain } : {})
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
