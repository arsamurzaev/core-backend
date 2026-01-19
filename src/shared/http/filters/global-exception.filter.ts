// под твой проект (у тебя client в @generated)
import { Prisma } from '@generated/client'
import {
	ArgumentsHost,
	Catch,
	ExceptionFilter,
	HttpException,
	HttpStatus
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

function prismaToHttp(exception: Prisma.PrismaClientKnownRequestError): {
	status: number
	message: string
} {
	switch (exception.code) {
		case 'P2002': {
			// Unique constraint failed
			const target = (exception.meta as any)?.target
			const fields = Array.isArray(target) ? target.join(', ') : target
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
	catch(exception: unknown, host: ArgumentsHost) {
		const ctx = host.switchToHttp()
		const res = ctx.getResponse<Response>()
		const req = ctx.getRequest<Request>()

		const store = RequestContext.get()
		const requestId = store?.requestId

		const isDev = process.env.NODE_ENV !== 'production'

		let status = HttpStatus.INTERNAL_SERVER_ERROR
		let message: string | string[] = 'Internal Server Error'

		console.log(exception)

		// Nest HttpException
		if (exception instanceof HttpException) {
			status = exception.getStatus()

			const response = exception.getResponse()
			if (typeof response === 'string') {
				message = response
			} else if (response && typeof response === 'object') {
				const m = (response as any).message
				message = m ?? (response as any).error ?? exception.message
			} else {
				message = exception.message
			}
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
			message = isDev ? exception.message : 'Internal Server Error'
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
