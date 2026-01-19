import { CatalogCreateInput } from '@generated/models'
import { Injectable } from '@nestjs/common'
import { hash } from 'argon2'

import { CatalogRepository } from './catalog.repository'
import { CreateCatalogDtoReq } from './dto/requests/create-catalog.dto.req'

@Injectable()
export class CatalogService {
	constructor(private readonly repo: CatalogRepository) {}

	async create(dto: CreateCatalogDtoReq) {
		const { password, typeId, status, ...rest } = dto

		const passwordHash = await hash(password)

		const data: CatalogCreateInput = {
			...rest,
			type: { connect: { id: typeId } },
			password: passwordHash,
			config: {
				create: {
					status
				}
			}
		}

		await this.repo.create(data)
		return { ok: true }
	}
}
