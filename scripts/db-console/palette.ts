import { runCatalogDiagnostics } from './catalog-diagnostics.js'
import { runCatalogCockpit, runProductCategoryTools } from './cockpit.js'
import { runHealthMenu } from './health.js'
import {
	chooseModel,
	restoreFromBackup,
	runModelMenu
} from './model-actions.js'
import { askText, fuzzyChoose, pause, printJsonHelp } from './prompt.js'
import type { AppContext, ModelMeta, SchemaMeta } from './types.js'
import { runQueryWorkspace } from './workspace.js'

type PaletteAction =
	| { type: 'workspace' }
	| { type: 'browseModel' }
	| { type: 'openModel'; model: ModelMeta }
	| { type: 'catalog' }
	| { type: 'catalogDiagnostics' }
	| { type: 'productTools' }
	| { type: 'health' }
	| { type: 'restoreBackup' }
	| { type: 'help' }

export async function runCommandPalette(
	ctx: AppContext,
	models: ModelMeta[],
	schemaMeta: SchemaMeta
) {
	const action = await fuzzyChoose<PaletteAction>(
		'Command palette',
		[
			{ name: 'Query workspace', value: { type: 'workspace' } },
			{ name: 'Browse model...', value: { type: 'browseModel' } },
			{ name: 'Catalog cockpit', value: { type: 'catalog' } },
			{
				name: 'Catalog deep diagnostics',
				value: { type: 'catalogDiagnostics' }
			},
			{ name: 'Product/Category tools', value: { type: 'productTools' } },
			{ name: 'Health checks', value: { type: 'health' } },
			{ name: 'Restore from backup', value: { type: 'restoreBackup' } },
			{ name: 'JSON/where help', value: { type: 'help' } },
			...models.map(model => ({
				name: `Open ${model.name}`,
				value: { type: 'openModel' as const, model }
			}))
		],
		{ pageSize: 20 }
	)

	if (action.type === 'workspace') await runQueryWorkspace(ctx, models)
	if (action.type === 'browseModel') {
		await runModelMenu(ctx, await chooseModel(models), schemaMeta, models)
	}
	if (action.type === 'openModel') {
		await runModelMenu(ctx, action.model, schemaMeta, models)
	}
	if (action.type === 'catalog') await runCatalogCockpit(ctx, models)
	if (action.type === 'catalogDiagnostics') {
		const query = await askText('Catalog slug/name/domain/id', { required: true })
		await runCatalogDiagnostics(ctx, { query })
		await pause()
	}
	if (action.type === 'productTools') await runProductCategoryTools(ctx, models)
	if (action.type === 'health') await runHealthMenu(ctx, models)
	if (action.type === 'restoreBackup') await restoreFromBackup(ctx, models)
	if (action.type === 'help') {
		printJsonHelp()
		await pause()
	}
}
