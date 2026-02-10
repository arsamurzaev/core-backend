import { BadRequestException, Injectable } from '@nestjs/common'
import slugify from 'slugify'

import { CreateTypeDtoReq } from './dto/req/create-type.dto.req'
import { TypeRepository } from './type.repository'

const CODE_MAX_LENGTH = 50
const CODE_FALLBACK = 'type'

function normalizeCode(value: string): string {
	return value.trim().toLowerCase()
}

function slugifyValue(value: string): string {
	const slug = slugify(value, { lower: true, strict: true, trim: true })
	return slug.replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '')
}

function applySuffix(base: string, suffix: number): string {
	const suffixPart = suffix > 0 ? `-${suffix}` : ''
	const headLength = Math.max(0, CODE_MAX_LENGTH - suffixPart.length)
	const head = base.slice(0, headLength).replace(/-+$/g, '')
	return `${head}${suffixPart}`
}

@Injectable()
export class TypeService {
	constructor(private readonly repo: TypeRepository) {}

	async getAll() {
		return this.repo.findAll()
	}

	async create(dto: CreateTypeDtoReq) {
		const normalizedCode = dto.code ? normalizeCode(dto.code) : undefined
		if (normalizedCode) {
			await this.ensureCodeAvailable(normalizedCode)
		}

		const code = normalizedCode ?? (await this.generateCode(dto.name))
		return this.repo.create({ ...dto, code })
	}

	async delete(id: string) {
		await this.repo.delete(id)

		return { ok: true }
	}

	private async generateCode(name: string): Promise<string> {
		const base = slugifyValue(name) || CODE_FALLBACK
		return this.ensureUniqueCode(base)
	}

	private async ensureUniqueCode(base: string): Promise<string> {
		let candidate = applySuffix(base, 0)
		let suffix = 1

		while (await this.repo.existsCode(candidate)) {
			candidate = applySuffix(base, suffix)
			suffix += 1
		}

		return candidate
	}

	private async ensureCodeAvailable(code: string): Promise<void> {
		const exists = await this.repo.existsCode(code)
		if (exists) {
			throw new BadRequestException('Код типа уже используется')
		}
	}
}
