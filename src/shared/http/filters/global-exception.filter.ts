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

import { RequestContext } from '@/shared/tenancy/request-context'

type ErrorBody = {
	statusCode: number
	message: string | string[]
	path: string
	requestId?: string
	timestamp: string
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

function prismaToHttp(exception: Prisma.PrismaClientKnownRequestError): {
	status: number
	message: string
} {
	switch (exception.code) {
		case 'P2002': {
			// Unique constraint failed
			const fields = extractMetaTarget(exception.meta)
			return {
				status: HttpStatus.CONFLICT,
				message: fields ? `Уже существует: ${fields}` : 'Уже существует'
			}
		}
		case 'P2025':
			// Record not found
			return { status: HttpStatus.NOT_FOUND, message: 'Не найдено' }

		case 'P2003':
			// Foreign key constraint failed
			return {
				status: HttpStatus.BAD_REQUEST,
				message: 'Неверная связь (FK constraint)'
			}

		case 'P2000':
			// Value too long
			return {
				status: HttpStatus.BAD_REQUEST,
				message: 'Слишком длинное значение поля'
			}

		default:
			return { status: HttpStatus.BAD_REQUEST, message: 'Ошибка базы данных' }
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

		let status = HttpStatus.INTERNAL_SERVER_ERROR
		let message: string | string[] = 'Внутренняя ошибка сервера'

		// Nest HttpException
		if (exception instanceof HttpException) {
			status = exception.getStatus()

			const response = exception.getResponse()
			message = extractHttpMessage(response, exception.message)
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
			message = isDev ? exception.message : 'Внутренняя ошибка сервера'
		}

		const prefix = `[${requestId ?? '-'}] ${req.method} ${req.originalUrl ?? req.url}`

		if (status >= 500) {
			this.logger.error(
				`${prefix} → ${status}`,
				exception instanceof Error ? exception.stack : String(exception)
			)
		} else {
			this.logger.warn(
				`${prefix} → ${status}: ${Array.isArray(message) ? message.join(', ') : message}`
			)
		}

		const body: ErrorBody = {
			statusCode: status,
			message,
			path: req.originalUrl ?? req.url ?? '',
			requestId,
			timestamp: new Date().toISOString()
		}

		// корреляция в ответе
		if (requestId) res.setHeader('x-request-id', requestId)

		res.status(status).json(body)
	}
}
