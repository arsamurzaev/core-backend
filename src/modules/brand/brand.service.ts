import { BrandCreateInput, BrandUpdateInput } from '@generated/models'
import {
	BadRequestException,
	Injectable,
	NotFoundException
} from '@nestjs/common'

import { mustCatalogId } from '@/shared/tenancy/ctx'
import { assertHasUpdateFields } from '@/shared/utils'

import { BrandRepository } from './brand.repository'
import {
	buildBrandCreateInput,
	buildBrandUpdateInput,
	normalizeBrandName,
	normalizeBrandSlug
} from './brand.utils'
import { CreateBrandDtoReq } from './dto/requests/create-brand.dto.req'
import { UpdateBrandDtoReq } from './dto/requests/update-brand.dto.req'

@Injectable()
export class BrandService {
	constructor(private readonly repo: BrandRepository) {}

	async getAll() {
		const catalogId = mustCatalogId()
		return this.repo.findAll(catalogId)
	}

	async getById(id: string) {
		const catalogId = mustCatalogId()
		return this.requireBrand(await this.repo.findById(id, catalogId))
	}

	async create(dto: CreateBrandDtoReq) {
		const catalogId = mustCatalogId()
		const name = normalizeBrandName(dto.name)
		const slug = normalizeBrandSlug(dto.slug)
		await this.ensureSlugAvailable(catalogId, slug)

		const data: BrandCreateInput = buildBrandCreateInput(catalogId, name, slug)
		return this.repo.create(data)
	}

	async update(id: string, dto: UpdateBrandDtoReq) {
		const catalogId = mustCatalogId()
		let slug: string | undefined
		if (dto.slug !== undefined) {
			slug = normalizeBrandSlug(dto.slug)
			await this.ensureSlugAvailable(catalogId, slug, id)
		}

		const data: BrandUpdateInput = buildBrandUpdateInput({
			name: dto.name,
			slug
		})
		assertHasUpdateFields(data)

		return this.requireBrand(await this.repo.update(id, catalogId, data))
	}

	async remove(id: string) {
		const catalogId = mustCatalogId()
		this.requireBrand(await this.repo.softDelete(id, catalogId))

		return { ok: true }
	}

	private async ensureSlugAvailable(
		catalogId: string,
		slug: string,
		excludeId?: string
	): Promise<void> {
		const exists = await this.repo.existsSlug(catalogId, slug, excludeId)
		if (exists) {
			throw new BadRequestException(
				'slug СѓР¶Рµ РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ РІ РєР°С‚Р°Р»РѕРіРµ'
			)
		}
	}

	private requireBrand<T>(brand: T | null): T {
		if (!brand) throw new NotFoundException('Р‘СЂРµРЅРґ РЅРµ РЅР°Р№РґРµРЅ')
		return brand
	}
}
