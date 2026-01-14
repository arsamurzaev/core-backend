import { Prisma } from '@generated/client'
import {
    BadRequestException,
    ConflictException,
    HttpException,
    InternalServerErrorException,
    NotFoundException
} from '@nestjs/common'

function isHttpException(err: unknown): err is HttpException {
	return err instanceof HttpException
}

function isPrismaKnown(
	err: unknown
): err is Prisma.PrismaClientKnownRequestError {
	return err instanceof Prisma.PrismaClientKnownRequestError
}

function targetToString(target: unknown): string {
	if (Array.isArray(target)) return target.join(', ')
	if (typeof target === 'string') return target
	return 'field'
}

/**
 * Оборачивает любую операцию, чтобы:
 * - НЕ затирать HttpException (400/404/409) в 500
 * - Превращать Prisma ошибки в нормальные HTTP ошибки
 */
export async function prismaSafe<T>(
	action: () => Promise<T>,
	opts?: {
		uniqueMessage?: string
		notFoundMessage?: string
		fkMessage?: string
		defaultMessage?: string
	}
): Promise<T> {
	try {
		return await action()
	} catch (err: unknown) {
		// Твои BadRequestException и прочие HttpException оставляем как есть
		if (isHttpException(err)) throw err

		// Prisma ошибки
		if (isPrismaKnown(err)) {
			switch (err.code) {
				case 'P2002': {
					const target = targetToString((err.meta as any)?.target)
					throw new ConflictException(
						opts?.uniqueMessage ?? `Уникальность нарушена: ${target}`
					)
				}
				case 'P2025':
					throw new NotFoundException(opts?.notFoundMessage ?? 'Запись не найдена')
				case 'P2003':
					throw new BadRequestException(
						opts?.fkMessage ?? 'Нарушение связей: связанная запись не найдена'
					)
				default:
					throw new InternalServerErrorException(
						opts?.defaultMessage ?? 'Database error'
					)
			}
		}

		// Всё остальное
		throw new InternalServerErrorException(
			opts?.defaultMessage ?? 'Unexpected error'
		)
	}
}
