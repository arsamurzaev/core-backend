/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { colors, printJson, table } from './format.js'
import { getDelegate, scalarSelect } from './metadata.js'
import { askText, choose, pause, yesNo } from './prompt.js'
import { previewMassMutation, runAudited } from './safety.js'
import { exportRows, writeBackup } from './storage.js'
import type { AppContext, ModelMeta } from './types.js'

type CatalogRow = {
	id: string
	name: string
	slug: string
	domain?: string | null
	typeId?: string
	deleteAt?: Date | string | null
	createdAt?: Date | string
	updatedAt?: Date | string
}

export async function runCatalogCockpit(ctx: AppContext, models: ModelMeta[]) {
	const catalog = await chooseCatalog(ctx)
	if (!catalog) return

	while (true) {
		await printCatalogSummary(ctx, catalog)

		const action = await choose('Catalog cockpit', [
			{ name: 'Товары каталога', value: 'products' },
			{ name: 'Удаленные товары', value: 'deletedProducts' },
			{ name: 'Товары без media', value: 'productsWithoutMedia' },
			{ name: 'Товары без категории', value: 'uncategorizedProducts' },
			{ name: 'Категории', value: 'categories' },
			{ name: 'Заказы', value: 'orders' },
			{ name: 'Домены', value: 'domains' },
			{
				name: 'Массово soft-delete/restore товаров',
				value: 'productSoftTools',
				disabled: ctx.mode === 'readonly' ? 'readonly' : false
			},
			{
				name: 'Нормализовать позиции категорий',
				value: 'normalizeCategories',
				disabled: ctx.mode === 'readonly' ? 'readonly' : false
			},
			{
				name: 'Нормализовать позиции товаров в категориях',
				value: 'normalizeCategoryProducts',
				disabled: ctx.mode === 'readonly' ? 'readonly' : false
			},
			{ name: 'Показать catalog JSON', value: 'json' },
			{ name: 'Назад', value: 'back' }
		])

		if (action === 'back') return
		if (action === 'json') {
			printJson(catalog)
			await pause()
		}
		if (action === 'products') {
			await showRows(ctx, modelByName(models, 'Product'), {
				where: { catalogId: catalog.id, deleteAt: null },
				orderBy: { updatedAt: 'desc' }
			})
		}
		if (action === 'deletedProducts') {
			await showRows(ctx, modelByName(models, 'Product'), {
				where: { catalogId: catalog.id, deleteAt: { not: null } },
				orderBy: { deleteAt: 'desc' }
			})
		}
		if (action === 'productsWithoutMedia') {
			await showRows(ctx, modelByName(models, 'Product'), {
				where: { catalogId: catalog.id, deleteAt: null, media: { none: {} } },
				orderBy: { updatedAt: 'desc' }
			})
		}
		if (action === 'uncategorizedProducts') {
			await showRows(ctx, modelByName(models, 'Product'), {
				where: {
					catalogId: catalog.id,
					deleteAt: null,
					categoryProducts: { none: {} }
				},
				orderBy: { updatedAt: 'desc' }
			})
		}
		if (action === 'categories') {
			await showRows(ctx, modelByName(models, 'Category'), {
				where: { catalogId: catalog.id },
				orderBy: { position: 'asc' }
			})
		}
		if (action === 'orders') {
			await showRows(ctx, modelByName(models, 'Order'), {
				where: { catalogId: catalog.id },
				orderBy: { createdAt: 'desc' }
			})
		}
		if (action === 'domains') {
			await showRows(ctx, modelByName(models, 'CatalogDomain'), {
				where: { catalogId: catalog.id },
				orderBy: { createdAt: 'desc' }
			})
		}
		if (action === 'productSoftTools') {
			await productSoftTools(ctx, modelByName(models, 'Product'), catalog.id)
		}
		if (action === 'normalizeCategories') {
			await normalizeCategories(ctx, modelByName(models, 'Category'), catalog.id)
		}
		if (action === 'normalizeCategoryProducts') {
			await normalizeCategoryProducts(
				ctx,
				modelByName(models, 'CategoryProduct'),
				catalog.id
			)
		}
	}
}

export async function runProductCategoryTools(
	ctx: AppContext,
	models: ModelMeta[]
) {
	while (true) {
		const action = await choose('Product/Category tools', [
			{ name: 'Выбрать каталог и открыть cockpit', value: 'catalog' },
			{ name: 'Все товары без media', value: 'productsWithoutMedia' },
			{ name: 'Все товары без категории', value: 'uncategorizedProducts' },
			{ name: 'Назад', value: 'back' }
		])

		if (action === 'back') return
		if (action === 'catalog') await runCatalogCockpit(ctx, models)
		if (action === 'productsWithoutMedia') {
			await showRows(ctx, modelByName(models, 'Product'), {
				where: { deleteAt: null, media: { none: {} } },
				orderBy: { updatedAt: 'desc' }
			})
		}
		if (action === 'uncategorizedProducts') {
			await showRows(ctx, modelByName(models, 'Product'), {
				where: { deleteAt: null, categoryProducts: { none: {} } },
				orderBy: { updatedAt: 'desc' }
			})
		}
	}
}

async function chooseCatalog(ctx: AppContext): Promise<CatalogRow | null> {
	const query = await askText('Найти каталог по slug/name/domain/id', {
		required: false
	})
	const where = query
		? {
				OR: [
					{ id: query },
					{ slug: { contains: query, mode: 'insensitive' } },
					{ name: { contains: query, mode: 'insensitive' } },
					{ domain: { contains: query, mode: 'insensitive' } }
				]
			}
		: {}

	const catalogs = (await (ctx.prisma as any).catalog.findMany({
		where,
		take: 50,
		orderBy: { updatedAt: 'desc' },
		select: {
			id: true,
			name: true,
			slug: true,
			domain: true,
			typeId: true,
			deleteAt: true,
			createdAt: true,
			updatedAt: true
		}
	})) as CatalogRow[]

	if (!catalogs.length) {
		console.log(colors.yellow('Каталоги не найдены'))
		await pause()
		return null
	}

	return await choose(
		'Каталог',
		catalogs.map(catalog => ({
			name: `${catalog.name} (${catalog.slug}${catalog.domain ? `, ${catalog.domain}` : ''})`,
			value: catalog
		}))
	)
}

async function printCatalogSummary(ctx: AppContext, catalog: any) {
	const [
		products,
		deletedProducts,
		categories,
		brands,
		orders,
		domains,
		seo,
		integrations
	] = await Promise.all([
		(ctx.prisma as any).product.count({
			where: { catalogId: catalog.id, deleteAt: null }
		}),
		(ctx.prisma as any).product.count({
			where: { catalogId: catalog.id, deleteAt: { not: null } }
		}),
		(ctx.prisma as any).category.count({ where: { catalogId: catalog.id } }),
		(ctx.prisma as any).brand.count({ where: { catalogId: catalog.id } }),
		(ctx.prisma as any).order.count({ where: { catalogId: catalog.id } }),
		(ctx.prisma as any).catalogDomain.count({ where: { catalogId: catalog.id } }),
		(ctx.prisma as any).seoSetting.count({ where: { catalogId: catalog.id } }),
		(ctx.prisma as any).integration.count({ where: { catalogId: catalog.id } })
	])

	console.log('')
	console.log(colors.cyan(colors.bold(`${catalog.name} / ${catalog.slug}`)))
	table(
		[
			{
				products,
				deletedProducts,
				categories,
				brands,
				orders,
				domains,
				seo,
				integrations
			}
		],
		undefined,
		1
	)
}

async function showRows(
	ctx: AppContext,
	model: ModelMeta,
	args: Record<string, unknown>
) {
	const delegate = getDelegate(ctx.prisma, model)
	const rows = await delegate.findMany({
		...args,
		take: ctx.options.limit,
		select: scalarSelect(model)
	})

	table(rows, model, ctx.options.limit)

	const action = await choose('Действие', [
		{
			name: 'Export JSON',
			value: 'json',
			disabled: rows.length ? false : 'пусто'
		},
		{ name: 'Export CSV', value: 'csv', disabled: rows.length ? false : 'пусто' },
		{ name: 'Назад', value: 'back' }
	])

	if (action === 'back') return
	const file = await exportRows(
		ctx,
		model,
		rows as Record<string, unknown>[],
		action as 'json' | 'csv'
	)
	console.log(colors.green(`Export: ${file}`))
	await pause()
}

async function productSoftTools(
	ctx: AppContext,
	model: ModelMeta,
	catalogId: string
) {
	const delegate = getDelegate(ctx.prisma, model)
	const action = await choose('Product bulk action', [
		{ name: 'Soft-delete active products', value: 'softDelete' },
		{ name: 'Restore deleted products', value: 'restore' }
	])
	const status = await askText('Product status filter, Enter = any', {
		required: false
	})
	const where = {
		catalogId,
		...(status ? { status } : {}),
		...(action === 'softDelete'
			? { deleteAt: null }
			: { deleteAt: { not: null } })
	}
	const preview = await previewMassMutation(ctx, model, delegate, action, where)
	if (!preview.confirmed) return

	const data = { deleteAt: action === 'softDelete' ? new Date() : null }
	const result = await runAudited(
		ctx,
		{
			action,
			model: model.name,
			where,
			data,
			affectedCount: preview.count,
			backupPath: preview.backupPath
		},
		async () => await delegate.updateMany({ where, data })
	)

	console.log(colors.green(`Обновлено: ${result.count}`))
	await pause()
}

async function normalizeCategories(
	ctx: AppContext,
	model: ModelMeta,
	catalogId: string
) {
	const delegate = getDelegate(ctx.prisma, model)
	const rows = await delegate.findMany({
		where: { catalogId, deleteAt: null },
		orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
		select: scalarSelect(model)
	})
	const updates = rows
		.map((row: any, position: number) => ({ id: row.id, position }))
		.filter((update: any) => {
			const row = rows.find((item: any) => item.id === update.id)
			return row?.position !== update.position
		})

	if (!updates.length) {
		console.log(colors.green('Позиции уже нормализованы'))
		await pause()
		return
	}

	table(updates, undefined, updates.length)
	const accepted = await yesNo(`Обновить ${updates.length} позиций?`, false)
	if (!accepted) return

	const backupPath = await writeBackup(
		ctx,
		model,
		'normalizePositions',
		rows as Record<string, unknown>[],
		{ catalogId }
	)
	await runAudited(
		ctx,
		{
			action: 'normalizeCategoryPositions',
			model: model.name,
			where: { catalogId },
			affectedCount: updates.length,
			backupPath
		},
		async () => {
			for (const update of updates) {
				await delegate.update({
					where: { id: update.id },
					data: { position: update.position }
				})
			}
		}
	)

	console.log(colors.green('Позиции обновлены'))
	await pause()
}

async function normalizeCategoryProducts(
	ctx: AppContext,
	model: ModelMeta,
	catalogId: string
) {
	const delegate = getDelegate(ctx.prisma, model)
	const rows = await delegate.findMany({
		where: { category: { catalogId } },
		orderBy: [{ categoryId: 'asc' }, { position: 'asc' }, { productId: 'asc' }],
		select: scalarSelect(model)
	})
	const byCategory = new Map<string, any[]>()
	for (const row of rows) {
		const categoryRows = byCategory.get(row.categoryId) ?? []
		categoryRows.push(row)
		byCategory.set(row.categoryId, categoryRows)
	}

	const updates: { categoryId: string; productId: string; position: number }[] =
		[]
	for (const categoryRows of byCategory.values()) {
		categoryRows.forEach((row, position) => {
			if (row.position !== position) {
				updates.push({
					categoryId: row.categoryId,
					productId: row.productId,
					position
				})
			}
		})
	}

	if (!updates.length) {
		console.log(colors.green('Позиции category-products уже нормализованы'))
		await pause()
		return
	}

	table(updates, undefined, updates.length)
	const accepted = await yesNo(`Обновить ${updates.length} позиций?`, false)
	if (!accepted) return

	const backupPath = await writeBackup(
		ctx,
		model,
		'normalizeCategoryProductPositions',
		rows as Record<string, unknown>[],
		{ catalogId }
	)
	await runAudited(
		ctx,
		{
			action: 'normalizeCategoryProductPositions',
			model: model.name,
			where: { catalogId },
			affectedCount: updates.length,
			backupPath
		},
		async () => {
			for (const update of updates) {
				await delegate.update({
					where: {
						categoryId_productId: {
							categoryId: update.categoryId,
							productId: update.productId
						}
					},
					data: { position: update.position }
				})
			}
		}
	)

	console.log(colors.green('Позиции обновлены'))
	await pause()
}

function modelByName(models: ModelMeta[], name: string) {
	const model = models.find(model => model.name === name)
	if (!model) throw new Error(`Модель ${name} не найдена`)
	return model
}
