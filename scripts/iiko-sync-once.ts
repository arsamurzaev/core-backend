import { NestFactory } from '@nestjs/core'
import 'dotenv/config'

import { IntegrationProvider } from '../prisma/generated/enums.js'
import { AppModule } from '../src/core/app.module'
import { PrismaService } from '../src/infrastructure/prisma/prisma.service'
import { IikoSyncService } from '../src/modules/integration/providers/iiko/iiko.sync.service'

type CliOptions = {
	catalogId: string | null
	integrationId: string | null
	json: boolean
	help: boolean
}

async function main() {
	const options = parseCliOptions(process.argv.slice(2))
	if (options.help) {
		printHelp()
		return
	}

	const app = await NestFactory.createApplicationContext(AppModule, {
		logger: ['error', 'warn']
	})

	try {
		const prisma = app.get(PrismaService)
		const integration = await prisma.integration.findFirst({
			where: {
				provider: IntegrationProvider.IIKO,
				deleteAt: null,
				...(options.integrationId ? { id: options.integrationId } : {}),
				...(options.catalogId ? { catalogId: options.catalogId } : {})
			},
			orderBy: { updatedAt: 'desc' },
			select: {
				id: true,
				catalogId: true
			}
		})

		if (!integration) {
			throw new Error('Saved iiko integration was not found in local DB')
		}

		const sync = app.get(IikoSyncService, { strict: false })
		const result = await sync.syncCatalog(integration.catalogId)
		const output = {
			ok: true as const,
			integrationId: integration.id,
			catalogId: integration.catalogId,
			result
		}

		if (options.json) {
			console.log(JSON.stringify(output, null, 2))
			return
		}

		console.log('iiko sync completed')
		console.log(`Catalog: ${integration.catalogId}`)
		console.log(`Integration: ${integration.id}`)
		console.log(
			`Products: total=${result.totalProducts}, created=${result.createdProducts}, updated=${result.updatedProducts}, hidden=${result.deletedProducts}, skipped=${result.skippedProducts}`
		)
		console.log(
			`Variants: created=${result.createdVariants}, updated=${result.updatedVariants}, deleted=${result.deletedVariants}, skipped=${result.skippedVariants}`
		)
		console.log(`Images imported: ${result.imagesImported}`)
		console.log(`Revision: ${result.revision ?? 'n/a'}`)
		console.log(`Duration: ${result.durationMs}ms`)
	} finally {
		await app.close()
	}
}

function parseCliOptions(args: string[]): CliOptions {
	const options: CliOptions = {
		catalogId: normalizeOptionalString(process.env.IIKO_SYNC_CATALOG_ID),
		integrationId: normalizeOptionalString(process.env.IIKO_SYNC_INTEGRATION_ID),
		json: false,
		help: false
	}

	for (const arg of args) {
		if (arg === '--help' || arg === '-h') {
			options.help = true
			continue
		}
		if (arg === '--json') {
			options.json = true
			continue
		}

		const [rawKey, ...rawValueParts] = arg.split('=')
		const value = rawValueParts.join('=').trim()
		if (!rawKey || !rawKey.startsWith('--')) continue

		switch (rawKey) {
			case '--catalog-id':
				options.catalogId = normalizeOptionalString(value)
				break
			case '--integration-id':
				options.integrationId = normalizeOptionalString(value)
				break
		}
	}

	return options
}

function normalizeOptionalString(value: unknown): string | null {
	const normalized = typeof value === 'string' ? value.trim() : ''
	return normalized || null
}

function printHelp() {
	console.log(`
iiko one-shot sync

Env:
  IIKO_SYNC_CATALOG_ID      Optional catalog id.
  IIKO_SYNC_INTEGRATION_ID  Optional integration id.

Usage:
  npm run iiko:sync-once
  npm run iiko:sync-once -- --json
`)
}

main().catch(error => {
	console.error(error instanceof Error ? (error.stack ?? error.message) : error)
	process.exitCode = 1
})
