import { BadRequestException, Injectable } from '@nestjs/common'

import { prismaSafe } from '@/shared/prisma/prisma-error.helper'

import { CreateTypeDtoReq } from './dto/req/create-type.dto.req'
import { TypeRepository } from './type.repository'

@Injectable()
export class TypeService {
	constructor(private readonly repo: TypeRepository) {}

	async getAll() {
		return prismaSafe(async () => {
			const types = await this.repo.findAll()

			return types
		})
	}

	async create(dto: CreateTypeDtoReq) {
		return prismaSafe(
			async () => {
				const exists = await this.repo.findByCode(dto.code)
				if (exists) {
					throw new BadRequestException('Тип с таким кодом уже существует')
				}

				const type = await this.repo.create(dto)
				return { id: type.id }
			},
			{
				uniqueMessage: 'Тип с таким кодом уже существует'
			}
		)
	}
}
