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
		summary: 'Создать или вернуть текущую корзину по cookie-токену'
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
	@ApiOperation({ summary: 'Получить текущую корзину по cookie-токену' })
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
		summary: 'Удалить или отвязать текущую корзину по cookie-токену'
	})
	@ApiNoContentResponse({
		description:
			'Текущая корзина удалена или отвязана, если она уже закреплена за менеджером'
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
	@ApiOperation({ summary: 'Выдать публичный ключ для текущей корзины' })
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
	@ApiOperation({ summary: 'Отправить текущую корзину как заказ за столом' })
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
	@ApiOperation({ summary: 'Получить данные стола по короткому коду' })
	@ApiParam({
		name: 'code',
		description: 'Короткий код стола, сохраненный на backend',
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
	@ApiOperation({ summary: 'Список столов iiko с активными корзинами' })
	@ApiOkResponse({ type: HallTableOverviewResponseDto })
	async listHallTables() {
		const catalogId = mustCatalogId()
		const tables = await this.cartService.listHallTables(catalogId)
		return { ok: true, tables }
	}

	@Post('hall-table/:code/session')
	@ApiOperation({
		summary: 'Создать или вернуть общую сессию корзины для стола'
	})
	@ApiParam({
		name: 'code',
		description: 'Короткий код стола, сохраненный на backend',
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
	@ApiOperation({ summary: 'Добавить или обновить позицию в текущей корзине' })
	@ApiBody({
		type: UpsertCartItemDtoReq,
		examples: {
			base: {
				summary: 'Добавить две единицы товара',
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
	@ApiOperation({ summary: 'SSE-поток текущей корзины' })
	@ApiProduces('text/event-stream')
	@ApiHeader({
		name: 'Last-Event-ID',
		required: false,
		description: 'ID последнего полученного события Redis Stream для SSE-replay'
	})
	@ApiOkResponse({
		description:
			'SSE-события: connected, ping, cart.updated, cart.status_changed',
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
	@ApiOperation({ summary: 'Получить публичную корзину по ключу' })
	@ApiParam({
		name: 'publicKey',
		description: 'Публичный ключ корзины',
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
	@ApiOperation({ summary: 'Закрепить корзину за менеджером' })
	@ApiParam({
		name: 'publicKey',
		description: 'Публичный ключ корзины',
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
	@ApiOperation({ summary: 'Обновить присутствие менеджера в корзине' })
	@ApiParam({
		name: 'publicKey',
		description: 'Публичный ключ корзины',
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
		summary: 'Перевести корзину в PAUSED после работы менеджера'
	})
	@ApiParam({
		name: 'publicKey',
		description: 'Публичный ключ корзины',
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
		summary: 'Преобразовать общую корзину в завершенный заказ'
	})
	@ApiParam({
		name: 'publicKey',
		description: 'Публичный ключ корзины',
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
		summary: 'Закрыть открытую общую корзину стола'
	})
	@ApiParam({
		name: 'publicKey',
		description: 'Публичный ключ корзины',
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
		summary: 'Сбросить открытую общую корзину стола'
	})
	@ApiParam({
		name: 'publicKey',
		description: 'Публичный ключ корзины',
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
		summary: 'Подтвердить общую корзину стола и отправить заказ в iiko'
	})
	@ApiParam({
		name: 'publicKey',
		description: 'Публичный ключ корзины',
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
		summary: 'Отправить публичную корзину стола на подтверждение официанту'
	})
	@ApiHeader({
		name: CART_GUEST_TOKEN_HEADER,
		required: false,
		description: 'Нужен для действий гостя за столом'
	})
	@ApiParam({
		name: 'publicKey',
		description: 'Публичный ключ корзины',
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
	@ApiOperation({ summary: 'Добавить или обновить позицию в публичной корзине' })
	@ApiHeader({
		name: CART_GUEST_TOKEN_HEADER,
		required: false,
		description: 'Нужен для действий гостя за столом'
	})
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
	@ApiOperation({ summary: 'Удалить позицию из публичной корзины' })
	@ApiHeader({
		name: CART_GUEST_TOKEN_HEADER,
		required: false,
		description: 'Нужен для действий гостя за столом'
	})
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
	@ApiOperation({ summary: 'SSE-поток публичной корзины' })
	@ApiParam({
		name: 'publicKey',
		description: 'Публичный ключ корзины',
		example: '5f7ec4ac9cc6c392419eec11850d45f1'
	})
	@ApiHeader({
		name: 'Last-Event-ID',
		required: false,
		description: 'ID последнего полученного события Redis Stream для SSE-replay'
	})
	@ApiProduces('text/event-stream')
	@ApiOkResponse({
		description:
			'SSE-события: connected, ping, cart.updated, cart.status_changed',
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
