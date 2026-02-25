import { BrandCreateInput, BrandUpdateInput } from '@generated/models'
import {
	BadRequestException,
	Injectable,
	NotFoundException
} from '@nestjs/common'

import { mustCatalogId } from '@/shared/tenancy/ctx'

import { BrandRepository } from './brand.repository'
import { CreateBrandDtoReq } from './dto/requests/create-brand.dto.req'
import { UpdateBrandDtoReq } from './dto/requests/update-brand.dto.req'

const BRAND_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

@Injectable()
export class BrandService {
	constructor(private readonly repo: BrandRepository) {}

	async getAll() {
		const catalogId = mustCatalogId()
		return this.repo.findAll(catalogId)
	}

	async getById(id: string) {
		const catalogId = mustCatalogId()
		const brand = await this.repo.findById(id, catalogId)
		if (!brand) throw new NotFoundException('Бренд не найден')
		return brand
	}

	async create(dto: CreateBrandDtoReq) {
		const catalogId = mustCatalogId()
		const name = this.normalizeRequired(dto.name, 'name')
		const slug = this.normalizeSlug(dto.slug)
		await this.ensureSlugAvailable(catalogId, slug)

		const data: BrandCreateInput = {
			name,
			slug,
			catalog: { connect: { id: catalogId } }
		}
		return this.repo.create(data)
	}

	async update(id: string, dto: UpdateBrandDtoReq) {
		const catalogId = mustCatalogId()
		const data: BrandUpdateInput = {}

		if (dto.name !== undefined) {
			data.name = this.normalizeRequired(dto.name, 'name')
		}
		if (dto.slug !== undefined) {
			const slug = this.normalizeSlug(dto.slug)
			await this.ensureSlugAvailable(catalogId, slug, id)
			data.slug = slug
		}

		if (Object.keys(data).length === 0) {
			throw new BadRequestException('Нет полей для обновления')
		}

		const brand = await this.repo.update(id, catalogId, data)
		if (!brand) throw new NotFoundException('Бренд не найден')

		return brand
	}

	async remove(id: string) {
		const catalogId = mustCatalogId()
		const brand = await this.repo.softDelete(id, catalogId)
		if (!brand) throw new NotFoundException('Бренд не найден')

		return { ok: true }
	}

	private normalizeRequired(value: string, name: string): string {
		const normalized = String(value).trim()
		if (!normalized) {
			throw new BadRequestException(`Поле ${name} обязательно`)
		}
		return normalized
	}

	private normalizeSlug(value: string): string {
		const normalized = this.normalizeRequired(value, 'slug').toLowerCase()
		if (!BRAND_SLUG_PATTERN.test(normalized)) {
			throw new BadRequestException(
				'slug должен содержать только латиницу в нижнем регистре, цифры и дефисы'
			)
		}
		return normalized
	}

	private async ensureSlugAvailable(
		catalogId: string,
		slug: string,
		excludeId?: string
	): Promise<void> {
		const exists = await this.repo.existsSlug(catalogId, slug, excludeId)
		if (exists) {
			throw new BadRequestException('slug уже используется в каталоге')
		}
	}
}
