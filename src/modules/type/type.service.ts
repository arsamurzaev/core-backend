import { Injectable } from '@nestjs/common'

import { CreateTypeDtoReq } from './dto/req/create-type.dto.req'
import { TypeRepository } from './type.repository'

@Injectable()
export class TypeService {
	constructor(private readonly repo: TypeRepository) {}

	async getAll() {
		return this.repo.findAll()
	}

	async create(dto: CreateTypeDtoReq) {
		return this.repo.create(dto)
	}

	async delete(id: string) {
		await this.repo.delete(id)

		return { ok: true }
	}
}
