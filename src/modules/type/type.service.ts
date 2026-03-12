import { BadRequestException, Injectable } from '@nestjs/common'

import { CreateTypeDtoReq } from './dto/req/create-type.dto.req'
import { TypeRepository } from './type.repository'
import {
	buildTypeCodeBase,
	generateUniqueTypeCode,
	normalizeTypeCode
} from './type.utils'

@Injectable()
export class TypeService {
	constructor(private readonly repo: TypeRepository) {}

	async getAll() {
		return this.repo.findAll()
	}

	async create(dto: CreateTypeDtoReq) {
		const normalizedCode = dto.code ? normalizeTypeCode(dto.code) : undefined
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
		return generateUniqueTypeCode(buildTypeCodeBase(name), code =>
			this.repo.existsCode(code)
		)
	}

	private async ensureCodeAvailable(code: string): Promise<void> {
		const exists = await this.repo.existsCode(code)
		if (exists) {
			throw new BadRequestException('Код типа уже используется')
		}
	}
}
