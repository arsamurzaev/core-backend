import { LoggerService } from '@nestjs/common'
import { trace } from '@opentelemetry/api'
import { createWriteStream, mkdirSync, WriteStream } from 'node:fs'
import { dirname } from 'node:path'
import { inspect } from 'node:util'

import { RequestContext } from '@/shared/tenancy/request-context'

import {
	type ObservabilitySettings,
	resolveObservabilitySettings
} from './observability.settings'

type LogLevel = 'log' | 'error' | 'warn' | 'debug' | 'verbose' | 'fatal'

const RESET = '\x1b[0m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'

const LEVEL_COLOR: Record<LogLevel, string> = {
	log: '\x1b[32m', // green
	error: '\x1b[31m', // red
	fatal: '\x1b[35m', // magenta
	warn: '\x1b[33m', // yellow
	debug: '\x1b[34m', // blue
	verbose: '\x1b[36m' // cyan
}

const LEVEL_LABEL: Record<LogLevel, string> = {
	log: ' LOG ',
	error: ' ERR ',
	fatal: ' FTL ',
	warn: ' WRN ',
	debug: ' DBG ',
	verbose: ' VRB '
}

function formatTime(iso: string): string {
	return `${DIM}${iso.slice(11, 23)}${RESET}`
}

function formatLevel(level: LogLevel): string {
	const color = LEVEL_COLOR[level] ?? RESET
	return `${BOLD}${color}${LEVEL_LABEL[level]}${RESET}`
}

function formatContext(context?: string): string {
	if (!context) return ''
	return ` ${DIM}\x1b[36m[${context}]${RESET}`
}

function formatPretty(
	level: LogLevel,
	timestamp: string,
	message: string,
	context?: string,
	stack?: string
): string {
	const time = formatTime(timestamp)
	const lvl = formatLevel(level)
	const ctx = formatContext(context)
	const msg =
		level === 'error' || level === 'fatal'
			? `\x1b[31m${message}${RESET}`
			: level === 'warn'
				? `\x1b[33m${message}${RESET}`
				: message

	return `${time} ${lvl}${ctx} ${msg}${stack ? `\n${DIM}${stack}${RESET}` : ''}\n`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === 'object' &&
		value !== null &&
		Object.getPrototypeOf(value) === Object.prototype
	)
}

function serializeMessage(value: unknown): string {
	if (typeof value === 'string') return value
	if (typeof value === 'number' || typeof value === 'boolean')
		return value.toString()
	if (typeof value === 'bigint') return value.toString()
	if (typeof value === 'symbol') return value.toString()
	if (value === null) return 'null'
	if (value === undefined) return 'undefined'
	if (value instanceof Error) return value.message

	return inspect(value, { depth: 6, breakLength: Infinity, compact: true })
}

function resolveContext(optionalParams: unknown[]): {
	context?: string
	stack?: string
	details?: unknown[]
} {
	if (!optionalParams.length) {
		return {}
	}

	if (optionalParams.length === 1 && typeof optionalParams[0] === 'string') {
		return { context: optionalParams[0] }
	}

	if (
		optionalParams.length >= 2 &&
		typeof optionalParams[0] === 'string' &&
		typeof optionalParams[1] === 'string'
	) {
		const [, maybeContext, ...details] = optionalParams
		return {
			stack: optionalParams[0],
			context: maybeContext,
			details: details.length ? details : undefined
		}
	}

	const last = optionalParams.at(-1)
	if (typeof last === 'string') {
		return {
			context: last,
			details: optionalParams.slice(0, -1)
		}
	}

	return { details: optionalParams }
}

export class AppLogger implements LoggerService {
	private readonly settings: ObservabilitySettings
	private readonly fileStream?: WriteStream

	constructor(settings = resolveObservabilitySettings()) {
		this.settings = settings

		if (settings.logFilePath) {
			mkdirSync(dirname(settings.logFilePath), { recursive: true })
			this.fileStream = createWriteStream(settings.logFilePath, {
				flags: 'a',
				encoding: 'utf8'
			})
		}
	}

	log(message: unknown, ...optionalParams: unknown[]) {
		this.write('log', message, optionalParams)
	}

	error(message: unknown, ...optionalParams: unknown[]) {
		this.write('error', message, optionalParams)
	}

	warn(message: unknown, ...optionalParams: unknown[]) {
		this.write('warn', message, optionalParams)
	}

	debug?(message: unknown, ...optionalParams: unknown[]) {
		this.write('debug', message, optionalParams)
	}

	verbose?(message: unknown, ...optionalParams: unknown[]) {
		this.write('verbose', message, optionalParams)
	}

	fatal?(message: unknown, ...optionalParams: unknown[]) {
		this.write('fatal', message, optionalParams)
	}

	private write(level: LogLevel, message: unknown, optionalParams: unknown[]) {
		const { context, stack, details } = resolveContext(optionalParams)
		const requestContext = RequestContext.get()
		const activeSpan = trace.getActiveSpan()
		const spanContext = activeSpan?.spanContext()

		const entry: Record<string, unknown> = {
			timestamp: new Date().toISOString(),
			level,
			service: this.settings.serviceName,
			serviceVersion: this.settings.serviceVersion,
			environment: this.settings.deploymentEnvironment,
			pid: process.pid
		}

		if (context) entry.context = context
		if (requestContext?.requestId) entry.requestId = requestContext.requestId
		if (requestContext?.catalogId) entry.catalogId = requestContext.catalogId
		if (requestContext?.catalogSlug)
			entry.catalogSlug = requestContext.catalogSlug
		if (requestContext?.typeId) entry.typeId = requestContext.typeId
		if (requestContext?.host) entry.host = requestContext.host
		if (spanContext) {
			entry.traceId = spanContext.traceId
			entry.spanId = spanContext.spanId
		}

		if (message instanceof Error) {
			entry.message = message.message
			entry.errorName = message.name
			entry.stack = message.stack
		} else if (isPlainObject(message)) {
			Object.assign(entry, message)
			if (!('message' in message)) {
				entry.message = context ?? 'Structured log event'
			}
		} else {
			entry.message = serializeMessage(message)
		}

		if (stack && !entry.stack) entry.stack = stack
		if (details?.length) entry.details = details

		const jsonLine = `${JSON.stringify(entry)}\n`
		const textLine = formatPretty(
			level,
			entry.timestamp as string,
			serializeMessage(entry.message),
			context,
			stack
		)

		const line = this.settings.jsonLogsEnabled ? jsonLine : textLine
		if (level === 'error' || level === 'fatal') {
			process.stderr.write(line)
		} else {
			process.stdout.write(line)
		}

		if (this.fileStream) {
			this.fileStream.write(jsonLine)
		}
	}
}
