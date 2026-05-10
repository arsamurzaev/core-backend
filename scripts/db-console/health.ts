import { colors, table } from './format.js'
import { getDelegate, hasField } from './metadata.js'
import { pause } from './prompt.js'
import type { AppContext, ModelMeta } from './types.js'

export async function runHealthMenu(ctx: AppContext, models: ModelMeta[]) {
	while (true) {
		const { choose } = await import('./prompt.js')
		const action = await choose('Health checks', [
			{ name: 'Count по всем моделям', value: 'counts' },
			{ name: 'Soft-deleted count', value: 'softDeleted' },
			{ name: 'Orphan diagnostics', value: 'orphans' },
			{ name: 'PostgreSQL table sizes', value: 'sizes' },
			{ name: 'Назад', value: 'back' }
		])

		if (action === 'back') return
		if (action === 'counts') await counts(ctx, models)
		if (action === 'softDeleted') await softDeleted(ctx, models)
		if (action === 'orphans') await orphans(ctx)
		if (action === 'sizes') await tableSizes(ctx)
	}
}

async function counts(ctx: AppContext, models: ModelMeta[]) {
	const rows: { model: string; table: string; count: number | string }[] = []

	for (const model of models) {
		try {
			rows.push({
				model: model.name,
				table: model.dbName ?? '',
				count: await getDelegate(ctx.prisma, model).count()
			})
		} catch (error) {
			rows.push({
				model: model.name,
				table: model.dbName ?? '',
				count: error instanceof Error ? error.message : 'error'
			})
		}
	}

	table(rows, undefined, rows.length)
	await pause()
}

async function softDeleted(ctx: AppContext, models: ModelMeta[]) {
	const rows: { model: string; deleted: number | string }[] = []

	for (const model of models.filter(model => hasField(model, 'deleteAt'))) {
		try {
			rows.push({
				model: model.name,
				deleted: await getDelegate(ctx.prisma, model).count({
					where: { deleteAt: { not: null } }
				})
			})
		} catch (error) {
			rows.push({
				model: model.name,
				deleted: error instanceof Error ? error.message : 'error'
			})
		}
	}

	table(rows, undefined, rows.length)
	await pause()
}

async function orphans(ctx: AppContext) {
	const checks = [
		{
			name: 'Product.catalogId',
			sql: `select count(*)::int as count from products p left join catalogs c on c.id = p.catalog_id where c.id is null`
		},
		{
			name: 'Category.catalogId',
			sql: `select count(*)::int as count from categories c left join catalogs ct on ct.id = c.catalog_id where ct.id is null`
		},
		{
			name: 'CategoryProduct.productId',
			sql: `select count(*)::int as count from category_products cp left join products p on p.id = cp.product_id where p.id is null`
		},
		{
			name: 'CategoryProduct.categoryId',
			sql: `select count(*)::int as count from category_products cp left join categories c on c.id = cp.category_id where c.id is null`
		},
		{
			name: 'ProductMedia.productId',
			sql: `select count(*)::int as count from product_media pm left join products p on p.id = pm.product_id where p.id is null`
		},
		{
			name: 'ProductMedia.mediaId',
			sql: `select count(*)::int as count from product_media pm left join media m on m.id = pm.media_id where m.id is null`
		}
	]

	const rows = []
	for (const check of checks) {
		try {
			const result = await ctx.prisma.$queryRawUnsafe<
				{
					count: number
				}[]
			>(check.sql)
			rows.push({ check: check.name, count: result[0]?.count ?? 0 })
		} catch (error) {
			rows.push({
				check: check.name,
				count: error instanceof Error ? error.message : 'error'
			})
		}
	}

	table(rows, undefined, rows.length)
	await pause()
}

async function tableSizes(ctx: AppContext) {
	const rows = await ctx.prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
		select
			relname as table,
			pg_size_pretty(pg_total_relation_size(relid)) as total_size,
			pg_total_relation_size(relid)::bigint as bytes
		from pg_catalog.pg_statio_user_tables
		order by pg_total_relation_size(relid) desc
		limit 50
	`)

	console.log(colors.dim('Read-only query через pg_catalog'))
	table(rows, undefined, rows.length)
	await pause()
}
