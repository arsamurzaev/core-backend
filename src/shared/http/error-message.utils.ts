import { HttpStatus } from '@nestjs/common'
import type { ValidationError } from 'class-validator'

const DEFAULT_HTTP_ERROR_MESSAGES: Partial<Record<number, string>> = {
	[HttpStatus.BAD_REQUEST]: 'Некорректный запрос',
	[HttpStatus.UNAUTHORIZED]: 'Не авторизован',
	[HttpStatus.FORBIDDEN]: 'Доступ запрещён',
	[HttpStatus.NOT_FOUND]: 'Ресурс не найден',
	[HttpStatus.METHOD_NOT_ALLOWED]: 'Метод запроса не поддерживается',
	[HttpStatus.CONFLICT]: 'Конфликт данных',
	[HttpStatus.PAYLOAD_TOO_LARGE]: 'Размер запроса слишком большой',
	[HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'Неподдерживаемый тип данных',
	[HttpStatus.UNPROCESSABLE_ENTITY]: 'Ошибка валидации',
	[HttpStatus.TOO_MANY_REQUESTS]:
		'Вы отправили слишком много запросов. Повторите через 1 минуту.',
	[HttpStatus.INTERNAL_SERVER_ERROR]: 'Внутренняя ошибка сервера',
	[HttpStatus.SERVICE_UNAVAILABLE]: 'Сервис временно недоступен'
}

const EXACT_MESSAGE_TRANSLATIONS = new Map<string, string>([
	['Bad Request Exception', DEFAULT_HTTP_ERROR_MESSAGES[HttpStatus.BAD_REQUEST]],
	['Unauthorized', DEFAULT_HTTP_ERROR_MESSAGES[HttpStatus.UNAUTHORIZED]],
	[
		'Unauthorized Exception',
		DEFAULT_HTTP_ERROR_MESSAGES[HttpStatus.UNAUTHORIZED]
	],
	['Forbidden', DEFAULT_HTTP_ERROR_MESSAGES[HttpStatus.FORBIDDEN]],
	['Forbidden resource', DEFAULT_HTTP_ERROR_MESSAGES[HttpStatus.FORBIDDEN]],
	['Not Found', DEFAULT_HTTP_ERROR_MESSAGES[HttpStatus.NOT_FOUND]],
	['Not Found Exception', DEFAULT_HTTP_ERROR_MESSAGES[HttpStatus.NOT_FOUND]],
	['Conflict', DEFAULT_HTTP_ERROR_MESSAGES[HttpStatus.CONFLICT]],
	['Conflict Exception', DEFAULT_HTTP_ERROR_MESSAGES[HttpStatus.CONFLICT]],
	[
		'Payload Too Large',
		DEFAULT_HTTP_ERROR_MESSAGES[HttpStatus.PAYLOAD_TOO_LARGE]
	],
	[
		'Unsupported Media Type',
		DEFAULT_HTTP_ERROR_MESSAGES[HttpStatus.UNSUPPORTED_MEDIA_TYPE]
	],
	[
		'Method Not Allowed',
		DEFAULT_HTTP_ERROR_MESSAGES[HttpStatus.METHOD_NOT_ALLOWED]
	],
	['Too Many Requests', buildRateLimitMessage(60_000)],
	['ThrottlerException: Too Many Requests', buildRateLimitMessage(60_000)],
	[
		'Internal Server Error',
		DEFAULT_HTTP_ERROR_MESSAGES[HttpStatus.INTERNAL_SERVER_ERROR]
	]
])

function pluralizeMinutes(value: number): string {
	const remainder10 = value % 10
	const remainder100 = value % 100

	if (remainder10 === 1 && remainder100 !== 11) {
		return 'минуту'
	}
	if (
		remainder10 >= 2 &&
		remainder10 <= 4 &&
		(remainder100 < 12 || remainder100 > 14)
	) {
		return 'минуты'
	}
	return 'минут'
}

function translateConstraintMessage(message: string): string | null {
	const fieldRequiredMatch = message.match(
		/^([A-Za-z][A-Za-z0-9_.-]*) обязателен$/
	)
	if (fieldRequiredMatch) {
		return `Поле ${fieldRequiredMatch[1]} обязательно`
	}

	const fieldEmptyMatch = message.match(
		/^([A-Za-z][A-Za-z0-9_.-]*) не может быть пустым$/
	)
	if (fieldEmptyMatch) {
		return `Поле ${fieldEmptyMatch[1]} не может быть пустым`
	}

	const fieldDuplicateMatch = message.match(
		/^Дублирующиеся ([A-Za-z][A-Za-z0-9_.-]*)$/
	)
	if (fieldDuplicateMatch) {
		return `Значения ${fieldDuplicateMatch[1]} не должны повторяться`
	}

	const betweenFieldsMatch = message.match(
		/^([A-Za-z][A-Za-z0-9_.-]*) не может быть больше ([A-Za-z][A-Za-z0-9_.-]*)$/
	)
	if (betweenFieldsMatch) {
		return `Параметр ${betweenFieldsMatch[1]} не может быть больше ${betweenFieldsMatch[2]}`
	}

	const matchers: Array<[RegExp, (...args: string[]) => string]> = [
		[
			/^property (.+) should not exist$/i,
			field => `Поле ${field} не должно присутствовать в запросе`
		],
		[/^(.+) must be a string$/i, field => `Поле ${field} должно быть строкой`],
		[
			/^(.+) should not be empty$/i,
			field => `Поле ${field} не может быть пустым`
		],
		[
			/^(.+) must be shorter than or equal to (\d+) characters$/i,
			(field, max) => `Поле ${field} не должно превышать ${max} символов`
		],
		[
			/^(.+) must be longer than or equal to (\d+) characters$/i,
			(field, min) => `Поле ${field} должно содержать не менее ${min} символов`
		],
		[/^(.+) must be an array$/i, field => `Поле ${field} должно быть массивом`],
		[
			/^(.+) must be an integer number$/i,
			field => `Поле ${field} должно быть целым числом`
		],
		[
			/^(.+) must be a number conforming to the specified constraints$/i,
			field => `Поле ${field} должно быть числом`
		],
		[
			/^(.+) must be a boolean value$/i,
			field => `Поле ${field} должно быть логическим значением`
		],
		[
			/^(.+) must be an email$/i,
			field => `Поле ${field} должно быть email-адресом`
		],
		[
			/^(.+) must be a URL address$/i,
			field => `Поле ${field} должно быть URL-адресом`
		],
		[/^(.+) must be a UUID$/i, field => `Поле ${field} должно быть UUID`],
		[
			/^(.+) must be a valid ISO 8601 date string$/i,
			field => `Поле ${field} должно быть датой в формате ISO 8601`
		],
		[
			/^(.+) must be one of the following values: (.+)$/i,
			(field, values) =>
				`Поле ${field} должно содержать одно из допустимых значений: ${values}`
		]
	]

	for (const [pattern, formatter] of matchers) {
		const match = message.match(pattern)
		if (match) {
			return formatter(...match.slice(1))
		}
	}

	return null
}

function normalizeSingleErrorMessage(message: string, status?: number): string {
	const normalizedMessage = message.trim()
	if (!normalizedMessage) {
		return getDefaultHttpErrorMessage(status)
	}

	const exactTranslation = EXACT_MESSAGE_TRANSLATIONS.get(normalizedMessage)
	if (exactTranslation) {
		return exactTranslation
	}

	const translatedConstraint = translateConstraintMessage(normalizedMessage)
	if (translatedConstraint) {
		return translatedConstraint
	}

	return normalizedMessage
}

function collectValidationMessagesRecursive(
	error: ValidationError,
	result: string[]
) {
	if (error.constraints) {
		for (const message of Object.values(error.constraints)) {
			result.push(normalizeSingleErrorMessage(message, HttpStatus.BAD_REQUEST))
		}
	}

	for (const child of error.children ?? []) {
		collectValidationMessagesRecursive(child, result)
	}
}

export function buildRateLimitMessage(msRemaining: number): string {
	const normalizedMs = msRemaining > 0 ? msRemaining : 60_000
	const minutes = Math.max(1, Math.ceil(normalizedMs / 60_000))
	return `Вы отправили слишком много запросов. Повторите через ${minutes} ${pluralizeMinutes(minutes)}.`
}

export function getDefaultHttpErrorMessage(status?: number): string {
	if (status && DEFAULT_HTTP_ERROR_MESSAGES[status]) {
		return DEFAULT_HTTP_ERROR_MESSAGES[status]
	}

	return 'Произошла ошибка'
}

export function normalizeErrorMessages(
	message: string | string[],
	status?: number
): string | string[] {
	if (Array.isArray(message)) {
		return [
			...new Set(message.map(item => normalizeSingleErrorMessage(item, status)))
		]
	}

	return normalizeSingleErrorMessage(message, status)
}

export function collectValidationErrorMessages(
	errors: ValidationError[]
): string[] {
	const messages: string[] = []

	for (const error of errors) {
		collectValidationMessagesRecursive(error, messages)
	}

	return messages.length
		? [...new Set(messages)]
		: [getDefaultHttpErrorMessage(HttpStatus.BAD_REQUEST)]
}
