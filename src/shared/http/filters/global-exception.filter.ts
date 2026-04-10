import { Prisma } from '@generated/client'
import {
	ArgumentsHost,
	Catch,
	ExceptionFilter,
	HttpException,
	HttpStatus,
	Logger
} from '@nestjs/common'
import type { Request, Response } from 'express'

import {
	getDefaultHttpErrorMessage,
	normalizeErrorMessages
} from '@/shared/http/error-message.utils'
import { RequestContext } from '@/shared/tenancy/request-context'
import { formatUnknownValue } from '@/shared/utils'

type ErrorBody = {
	statusCode: number
	message: string | string[]
	path: string
	requestId?: string
	timestamp: string
	clearCartKeys?: string[]
}

const HTTP_STATUS_VALUES = new Set<number>(
	Object.values(HttpStatus).filter(
		(value): value is number => typeof value === 'number'
	)
)

function toHttpStatus(status: number): HttpStatus {
	return HTTP_STATUS_VALUES.has(status)
		? (status as HttpStatus)
		: HttpStatus.INTERNAL_SERVER_ERROR
}

function extractMetaTarget(meta: unknown): string | null {
	if (!meta || typeof meta !== 'object') return null
	if (!('target' in meta)) return null

	const target = (meta as { target?: unknown }).target
	if (Array.isArray(target)) {
		const fields = target.filter(
			(field): field is string => typeof field === 'string'
		)
		return fields.length ? fields.join(', ') : null
	}
	if (typeof target === 'string') return target
	return null
}

function extractHttpMessage(
	response: unknown,
	fallback: string
): string | string[] {
	if (typeof response === 'string') return response
	if (!response || typeof response !== 'object') return fallback

	const payload = response as { message?: unknown; error?: unknown }
	if (typeof payload.message === 'string' || Array.isArray(payload.message)) {
		return payload.message
	}
	if (typeof payload.error === 'string') {
		return payload.error
	}
	return fallback
}

function messageIncludes(
	message: string | string[],
	expected: string
): boolean {
	if (Array.isArray(message)) {
		return message.includes(expected)
	}

	return message === expected
}

function shouldClearPublicCartKeys(
	path: string,
	status: HttpStatus,
	message: string | string[]
): boolean {
	return (
		status === HttpStatus.NOT_FOUND &&
		path.includes('/cart/public/') &&
		messageIncludes(message, 'Корзина не найдена')
	)
}

function prismaToHttp(exception: Prisma.PrismaClientKnownRequestError): {
	status: HttpStatus
	message: string
} {
	switch (exception.code) {
		case 'P2002': {
			// Unique constraint failed
			const fields = extractMetaTarget(exception.meta)
			return {
				status: HttpStatus.CONFLICT,
				message: fields
					? `Запись с такими данными уже существует: ${fields}`
					: 'Запись с такими данными уже существует'
			}
		}
		case 'P2025':
			// Record not found
			return { status: HttpStatus.NOT_FOUND, message: 'Запись не найдена' }

		case 'P2003':
			// Foreign key constraint failed
			return {
				status: HttpStatus.BAD_REQUEST,
				message: 'Указана несуществующая связанная запись'
			}

		case 'P2000':
			// Value too long
			return {
				status: HttpStatus.BAD_REQUEST,
				message: 'Значение одного из полей слишком длинное'
			}

		default:
			return {
				status: HttpStatus.BAD_REQUEST,
				message: 'Ошибка при обращении к базе данных'
			}
	}
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
	private readonly logger = new Logger(GlobalExceptionFilter.name)

	catch(exception: unknown, host: ArgumentsHost) {
		const ctx = host.switchToHttp()
		const res = ctx.getResponse<Response>()
		const req = ctx.getRequest<Request>()

		const store = RequestContext.get()
		const requestId = store?.requestId

		const isDev = process.env.NODE_ENV !== 'production'

		let status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR
		let message: string | string[] = getDefaultHttpErrorMessage(status)

		// Nest HttpException
		if (exception instanceof HttpException) {
			status = toHttpStatus(exception.getStatus())

			const response = exception.getResponse()
			message = extractHttpMessage(
				response,
				exception.message || getDefaultHttpErrorMessage(status)
			)
		}
		// Prisma known errors
		else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
			const mapped = prismaToHttp(exception)
			status = mapped.status
			message = mapped.message
		}
		// Prisma validation / unknown request errors
		else if (
			exception instanceof Prisma.PrismaClientValidationError ||
			exception instanceof Prisma.PrismaClientUnknownRequestError
		) {
			status = HttpStatus.BAD_REQUEST
			message = 'Некорректный запрос к базе данных'
		}
		// Any other error
		else if (exception instanceof Error) {
			status = HttpStatus.INTERNAL_SERVER_ERROR
			message = isDev
				? exception.message
				: getDefaultHttpErrorMessage(HttpStatus.INTERNAL_SERVER_ERROR)
		}

		message = normalizeErrorMessages(message, status)

		const prefix = `[${requestId ?? '-'}] ${req.method} ${req.originalUrl ?? req.url}`
		const path = req.originalUrl ?? req.url ?? ''
		const clearPublicCartKeys = shouldClearPublicCartKeys(path, status, message)

		if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
			this.logger.error(
				`${prefix} → ${status}`,
				exception instanceof Error ? exception.stack : formatUnknownValue(exception)
			)
		} else {
			this.logger.warn(
				`${prefix} → ${status}: ${Array.isArray(message) ? message.join(', ') : message}`
			)
		}

		const body: ErrorBody = {
			statusCode: status,
			message,
			path,
			requestId,
			timestamp: new Date().toISOString(),
			...(clearPublicCartKeys
				? { clearCartKeys: ['publicKey', 'checkoutKey'] }
				: {})
		}

		// корреляция в ответе
		if (requestId) res.setHeader('x-request-id', requestId)
		if (clearPublicCartKeys) {
			res.setHeader('x-cart-clear-public-key', 'true')
			res.setHeader('x-cart-clear-checkout-key', 'true')
		}

		res.status(status).json(body)
	}
}
