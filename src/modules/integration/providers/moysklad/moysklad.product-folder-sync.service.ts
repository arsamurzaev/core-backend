import { Injectable, Logger } from '@nestjs/common'

import { IntegrationRepository } from '../../integration.repository'
import { renderSafeProviderErrorMessage } from '../../provider-error-redaction'

import { MoySkladClient } from './moysklad.client'
import type {
	MoySkladProduct,
	MoySkladProductFolder,
	MoySkladProductFolderRef
} from './moysklad.types'

type ResolvedProductFolder = {
	externalId: string
	name: string
	externalParentId: string | null
}

type ProductFolderCategory = {
	id: string
	name: string
	parentId: string | null
}

type ProductFolderCategoryLink = {
	externalId: string
	category: ProductFolderCategory
}

type RepositoryTransaction = Parameters<
	IntegrationRepository['syncManagedProductCategories']
>[4]

type ProductFolderRawMeta = {
	id: string
	name: string
	parentId: string | null
}

@Injectable()
export class MoySkladProductFolderSyncService {
	private readonly logger = new Logger(MoySkladProductFolderSyncService.name)

	constructor(private readonly repo: IntegrationRepository) {}

	async syncProductCategories(params: {
		catalogId: string
		integrationId: string
		productId: string
		productName: string
		client: MoySkladClient
		folder?: MoySkladProduct['productFolder']
		tx?: RepositoryTransaction
	}): Promise<boolean> {
		if (!params.folder) {
			const result = await this.repo.syncManagedProductCategories(
				params.productId,
				params.catalogId,
				params.integrationId,
				[],
				params.tx
			)
			if (result.removed > 0) {
				this.logger.log(
					`Removed ${result.removed} MoySklad-managed categories for product ${params.productName}`
				)
			}
			return result.added > 0 || result.removed > 0
		}

		const categories = await this.syncProductFolderChain({
			catalogId: params.catalogId,
			integrationId: params.integrationId,
			client: params.client,
			folder: params.folder,
			tx: params.tx
		})

		if (!categories.length) {
			return false
		}

		const leafCategory = categories.at(-1)
		if (!leafCategory) {
			return false
		}

		const result = await this.repo.syncManagedProductCategories(
			params.productId,
			params.catalogId,
			params.integrationId,
			[leafCategory.id],
			params.tx
		)

		this.logger.log(
			`Synced MoySklad category path for product ${params.productName}: ${categories.map(category => category.name).join(' > ')}`
		)

		return result.added > 0 || result.removed > 0
	}

	private async syncProductFolderChain(params: {
		catalogId: string
		integrationId: string
		client: MoySkladClient
		folder: MoySkladProductFolderRef
		tx?: RepositoryTransaction
	}): Promise<ProductFolderCategory[]> {
		const folders = this.collapseProductFolderChain(
			await this.resolveProductFolderChain(params.client, params.folder)
		)
		if (!folders.length) {
			return []
		}

		const categories: ProductFolderCategory[] = []
		let parentCategoryId: string | null = null

		for (const folder of folders) {
			const category = await this.ensureProductFolderCategory({
				catalogId: params.catalogId,
				integrationId: params.integrationId,
				folder,
				parentCategoryId,
				tx: params.tx
			})
			if (!category) {
				continue
			}

			categories.push(category)
			parentCategoryId = category.id
		}

		return categories
	}

	private collapseProductFolderChain(
		folders: ResolvedProductFolder[]
	): ResolvedProductFolder[] {
		if (folders.length <= 2) {
			return folders
		}

		const root = folders[0]
		const leaf = folders[folders.length - 1]

		return [root, leaf]
	}

	private async resolveProductFolderChain(
		client: MoySkladClient,
		folder: MoySkladProductFolderRef
	): Promise<ResolvedProductFolder[]> {
		try {
			const chain = await client.getProductFolderChain(folder)
			const normalized = chain
				.map(item => this.normalizeProductFolder(item))
				.filter((item): item is ResolvedProductFolder => Boolean(item))
			if (normalized.length > 0) {
				return normalized
			}
		} catch (error) {
			this.logger.warn(
				`Failed to resolve MoySklad folder chain for folder ${folder.id ?? '<unknown>'}: ${this.renderErrorMessage(error)}`
			)
		}

		const fallback = this.normalizeProductFolder(folder)
		return fallback ? [fallback] : []
	}

	private normalizeProductFolder(
		folder: MoySkladProductFolder | MoySkladProductFolderRef
	): ResolvedProductFolder | null {
		const externalId = readMoySkladString(folder.id)
		const name = readMoySkladString(folder.name)
		if (!externalId || !name) {
			return null
		}

		const externalParentId =
			'productFolder' in folder
				? readMoySkladNullableString(folder.productFolder?.id)
				: null

		return {
			externalId,
			name,
			externalParentId
		}
	}

	private async ensureProductFolderCategory(params: {
		catalogId: string
		integrationId: string
		folder: ResolvedProductFolder
		parentCategoryId: string | null
		tx?: RepositoryTransaction
	}): Promise<ProductFolderCategory | null> {
		const existingLink = await this.findCategoryLinkByExternalId(
			params.integrationId,
			params.folder.externalId,
			params.tx
		)

		if (existingLink) {
			let category = existingLink.category
			const shouldRename = category.name !== params.folder.name
			const shouldReparent =
				(category.parentId ?? null) !== (params.parentCategoryId ?? null)

			if (shouldRename || shouldReparent) {
				category =
					(await this.updateCategory({
						categoryId: category.id,
						catalogId: params.catalogId,
						data: {
							...(shouldRename ? { name: params.folder.name } : {}),
							...(shouldReparent ? { parentId: params.parentCategoryId } : {})
						},
						tx: params.tx
					})) ?? category
			}

			await this.repo.upsertCategoryLink(
				{
					integrationId: params.integrationId,
					categoryId: category.id,
					externalId: params.folder.externalId,
					externalParentId: params.folder.externalParentId,
					rawMeta: buildProductFolderRawMeta(params.folder)
				},
				params.tx
			)

			return category
		}

		let category = await this.findReusableProductFolderCategory(params)
		if (!category) {
			category = await this.createCategory(
				params.catalogId,
				params.folder.name,
				params.parentCategoryId ?? undefined,
				params.tx
			)
		} else {
			const shouldRename = category.name !== params.folder.name
			const shouldReparent =
				(category.parentId ?? null) !== (params.parentCategoryId ?? null)
			if (shouldRename || shouldReparent) {
				category =
					(await this.updateCategory({
						categoryId: category.id,
						catalogId: params.catalogId,
						data: {
							...(shouldRename ? { name: params.folder.name } : {}),
							...(shouldReparent ? { parentId: params.parentCategoryId } : {})
						},
						tx: params.tx
					})) ?? category
			}
		}

		await this.repo.upsertCategoryLink(
			{
				integrationId: params.integrationId,
				categoryId: category.id,
				externalId: params.folder.externalId,
				externalParentId: params.folder.externalParentId,
				rawMeta: buildProductFolderRawMeta(params.folder)
			},
			params.tx
		)

		return category
	}

	private async findReusableProductFolderCategory(params: {
		catalogId: string
		integrationId: string
		folder: ResolvedProductFolder
		parentCategoryId: string | null
		tx?: RepositoryTransaction
	}): Promise<ProductFolderCategory | null> {
		const candidates = await this.findCategoriesByName(
			params.catalogId,
			params.folder.name,
			params.tx
		)
		if (!candidates.length) {
			return null
		}

		const desiredParentId = params.parentCategoryId ?? null
		const exactParentMatches = candidates.filter(
			candidate => (candidate.parentId ?? null) === desiredParentId
		)
		const rootMatches = candidates.filter(
			candidate => candidate.parentId === null
		)

		const candidate =
			exactParentMatches.length === 1
				? exactParentMatches[0]
				: exactParentMatches.length === 0 && rootMatches.length === 1
					? rootMatches[0]
					: candidates.length === 1
						? candidates[0]
						: null

		if (!candidate) {
			return null
		}

		const existingLink = await this.findCategoryLinkByCategoryId(
			params.integrationId,
			candidate.id,
			params.tx
		)
		if (existingLink && existingLink.externalId !== params.folder.externalId) {
			return null
		}

		return candidate
	}

	private async createCategory(
		catalogId: string,
		name: string,
		parentId: string | undefined,
		tx?: RepositoryTransaction
	): Promise<ProductFolderCategory> {
		const category = normalizeCategory(
			(await this.repo.createCategory(catalogId, name, parentId, tx)) as unknown
		)
		if (!category) {
			throw new Error('MoySklad category sync failed to create category')
		}

		return category
	}

	private async updateCategory(params: {
		categoryId: string
		catalogId: string
		data: {
			name?: string
			parentId?: string | null
		}
		tx?: RepositoryTransaction
	}): Promise<ProductFolderCategory | null> {
		return normalizeCategory(
			(await this.repo.updateCategory(
				{
					categoryId: params.categoryId,
					catalogId: params.catalogId,
					data: params.data
				},
				params.tx
			)) as unknown
		)
	}

	private async findCategoriesByName(
		catalogId: string,
		name: string,
		tx?: RepositoryTransaction
	): Promise<ProductFolderCategory[]> {
		const categories = (await this.repo.findCategoriesByName(
			catalogId,
			name,
			tx
		)) as unknown

		return Array.isArray(categories)
			? categories.map(normalizeCategory).filter(isPresent)
			: []
	}

	private async findCategoryLinkByExternalId(
		integrationId: string,
		externalId: string,
		tx?: RepositoryTransaction
	): Promise<ProductFolderCategoryLink | null> {
		return normalizeCategoryLink(
			(await this.repo.findCategoryLinkByExternalId(
				integrationId,
				externalId,
				tx
			)) as unknown
		)
	}

	private async findCategoryLinkByCategoryId(
		integrationId: string,
		categoryId: string,
		tx?: RepositoryTransaction
	): Promise<{ externalId: string } | null> {
		return normalizeExternalLink(
			(await this.repo.findCategoryLinkByCategoryId(
				integrationId,
				categoryId,
				tx
			)) as unknown
		)
	}

	private renderErrorMessage(error: unknown): string {
		return renderSafeProviderErrorMessage(error)
	}
}

function isPresent<T>(value: T | null | undefined): value is T {
	return value !== null && value !== undefined
}

function normalizeCategory(value: unknown): ProductFolderCategory | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null
	}

	const record = value as Record<string, unknown>
	const id = readMoySkladString(record.id)
	const name = readMoySkladString(record.name)
	if (!id || !name) {
		return null
	}

	return {
		id,
		name,
		parentId: readMoySkladNullableString(record.parentId)
	}
}

function normalizeCategoryLink(
	value: unknown
): ProductFolderCategoryLink | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null
	}

	const record = value as Record<string, unknown>
	const externalId = readMoySkladString(record.externalId)
	const category = normalizeCategory(record.category)
	if (!externalId || !category) {
		return null
	}

	return { externalId, category }
}

function normalizeExternalLink(value: unknown): { externalId: string } | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null
	}

	const externalId = readMoySkladString(
		(value as Record<string, unknown>).externalId
	)
	return externalId ? { externalId } : null
}

function buildProductFolderRawMeta(
	folder: ResolvedProductFolder
): ProductFolderRawMeta {
	return {
		id: folder.externalId,
		name: folder.name,
		parentId: folder.externalParentId
	}
}

function readMoySkladString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : ''
}

function readMoySkladNullableString(value: unknown): string | null {
	const normalized = readMoySkladString(value)
	return normalized || null
}
