import { HttpStatus } from '@nestjs/common'
import type { ValidationError } from 'class-validator'

import {
	buildRateLimitMessage,
	collectValidationErrorMessages,
	normalizeErrorMessages
} from './error-message.utils'

describe('error-message.utils', () => {
	it('builds a throttling message with rounded up minutes', () => {
		expect(buildRateLimitMessage(60_000)).toBe(
			'Вы отправили слишком много запросов. Повторите через 1 минуту.'
		)
		expect(buildRateLimitMessage(120_001)).toBe(
			'Вы отправили слишком много запросов. Повторите через 3 минуты.'
		)
		expect(buildRateLimitMessage(5 * 60_000)).toBe(
			'Вы отправили слишком много запросов. Повторите через 5 минут.'
		)
	})

	it('translates default Nest HTTP messages to Russian', () => {
		expect(
			normalizeErrorMessages('Bad Request Exception', HttpStatus.BAD_REQUEST)
		).toBe('Некорректный запрос')
		expect(
			normalizeErrorMessages('Forbidden resource', HttpStatus.FORBIDDEN)
		).toBe('Доступ запрещён')
		expect(
			normalizeErrorMessages('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS)
		).toBe('Вы отправили слишком много запросов. Повторите через 1 минуту.')
		expect(
			normalizeErrorMessages(
				'ThrottlerException: Too Many Requests',
				HttpStatus.TOO_MANY_REQUESTS
			)
		).toBe('Вы отправили слишком много запросов. Повторите через 1 минуту.')
		expect(
			normalizeErrorMessages(
				'Вы отправили слишком много запросов. Повторите через 7 минут.',
				HttpStatus.TOO_MANY_REQUESTS
			)
		).toBe('Вы отправили слишком много запросов. Повторите через 7 минут.')
	})

	it('normalizes mixed messages with field names', () => {
		expect(
			normalizeErrorMessages('productId обязателен', HttpStatus.BAD_REQUEST)
		).toBe('Поле productId обязательно')
		expect(
			normalizeErrorMessages(
				'minPrice не может быть больше maxPrice',
				HttpStatus.BAD_REQUEST
			)
		).toBe('Параметр minPrice не может быть больше maxPrice')
	})

	it('translates validation messages to Russian', () => {
		const errors: ValidationError[] = [
			{
				property: 'unexpectedField',
				constraints: {
					whitelistValidation: 'property unexpectedField should not exist'
				}
			} as ValidationError,
			{
				property: 'name',
				constraints: {
					isString: 'name must be a string',
					isNotEmpty: 'name should not be empty'
				}
			} as ValidationError
		]

		expect(collectValidationErrorMessages(errors)).toEqual([
			'Поле unexpectedField не должно присутствовать в запросе',
			'Поле name должно быть строкой',
			'Поле name не может быть пустым'
		])
	})
})
