import { checkbox, confirm, input, select } from '@inquirer/prompts'
import { readFile } from 'node:fs/promises'

import { colors } from './format.js'

export type Choice<T> = {
	name: string
	value: T
	description?: string
	disabled?: boolean | string
}

export async function choose<T>(
	message: string,
	choices: Choice<T>[],
	pageSize = 15
): Promise<T> {
	return await select({
		message,
		choices,
		pageSize
	})
}

export async function chooseMany<T>(
	message: string,
	choices: Choice<T>[],
	pageSize = 15
): Promise<T[]> {
	return await checkbox({
		message,
		choices,
		pageSize
	})
}

export async function askText(
	message: string,
	options: { default?: string; required?: boolean } = {}
) {
	while (true) {
		const value = await input({
			message,
			default: options.default
		})
		const trimmed = value.trim()

		if (trimmed || !options.required) return trimmed
		console.log(colors.yellow('Значение обязательно'))
	}
}

export async function yesNo(message: string, defaultValue = false) {
	return await confirm({
		message,
		default: defaultValue
	})
}

export async function pause(message = 'Enter для продолжения') {
	await input({ message })
}

export async function fuzzyChoose<T>(
	message: string,
	choices: Choice<T>[],
	options: { pageSize?: number; allowAll?: boolean } = {}
): Promise<T> {
	const query = await askText(`${message} search`, { required: false })
	const filtered = query ? fuzzyFilter(query, choices) : choices

	if (!filtered.length) {
		console.log(colors.yellow('Ничего не найдено, показываю полный список'))
		return await choose(message, choices, options.pageSize)
	}

	return await choose(message, filtered, options.pageSize)
}

export async function askJson<T = any>(
	message: string,
	defaultValue?: T,
	options: { required?: boolean } = {}
): Promise<T | undefined> {
	while (true) {
		const value = await askText(message, { required: options.required })

		if (!value) {
			if (!options.required) return defaultValue
			console.log(colors.yellow('JSON обязателен'))
			continue
		}

		if (value === '?') {
			printJsonHelp()
			continue
		}

		try {
			const source = value.startsWith('@')
				? await readFile(value.slice(1), 'utf8')
				: value
			return JSON.parse(source) as T
		} catch (error) {
			console.log(
				colors.red(error instanceof Error ? error.message : String(error))
			)
			console.log(colors.dim('Введи ? для примеров JSON.'))
		}
	}
}

export function printJsonHelp() {
	console.log(colors.bold('Примеры JSON для Prisma'))
	console.log(`where:
  {"name":{"contains":"shirt","mode":"insensitive"}}
  {"AND":[{"catalogId":"uuid"},{"deleteAt":null}]}
  {"createdAt":{"gte":"2026-01-01T00:00:00Z"}}

findMany args:
  {"where":{"status":"ACTIVE"},"orderBy":{"createdAt":"desc"},"take":20}
  {"where":{"catalog":{"slug":"hm"}},"include":{"catalog":true}}

create/update data:
  {"name":"New name","deleteAt":null}
  {"catalog":{"connect":{"id":"uuid"}}}

Файл:
  @tmp/query.json`)
}

function fuzzyFilter<T>(query: string, choices: Choice<T>[]) {
	const normalized = query.toLowerCase()
	return choices
		.map(choice => ({ choice, score: fuzzyScore(normalized, choice.name) }))
		.filter(item => item.score > 0)
		.sort((left, right) => right.score - left.score)
		.map(item => item.choice)
}

function fuzzyScore(query: string, candidate: string) {
	const value = candidate.toLowerCase()
	if (value.includes(query)) return 100 + query.length

	let score = 0
	let index = 0
	for (const char of query) {
		const found = value.indexOf(char, index)
		if (found === -1) return 0
		score += found === index ? 3 : 1
		index = found + 1
	}
	return score
}
