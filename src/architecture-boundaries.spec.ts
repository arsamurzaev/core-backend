import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import {
	dirname,
	extname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep
} from 'node:path'

const WORKSPACE_ROOT = process.cwd()
const MODULES_ROOT = resolve(WORKSPACE_ROOT, 'src', 'modules')
const CORE_ROOT = resolve(WORKSPACE_ROOT, 'src', 'core')
const SOURCE_EXTENSIONS = new Set(['.ts'])
const RESTRICTED_PUBLIC_SERVICE_EXPORTS = [
	{
		moduleName: 'auth',
		serviceNames: ['AuthService', 'SessionService', 'HandoffService']
	},
	{
		moduleName: 'audit',
		serviceNames: ['AuditService']
	},
	{
		moduleName: 'attribute',
		serviceNames: ['AttributeService']
	},
	{
		moduleName: 'capability',
		serviceNames: ['CapabilityService']
	},
	{
		moduleName: 'catalog-sale-unit',
		serviceNames: ['CatalogSaleUnitService', 'CatalogSaleUnitRepository']
	},
	{
		moduleName: 'catalog-price-list',
		serviceNames: ['CatalogPriceListService', 'CatalogPriceListResolverService']
	},
	{
		moduleName: 'catalog-modifier',
		serviceNames: ['CatalogModifierService', 'CatalogModifierRepository']
	},
	{
		moduleName: 'category',
		serviceNames: ['CategoryService']
	},
	{
		moduleName: 'email',
		serviceNames: ['EmailService']
	},
	{
		moduleName: 'integration',
		serviceNames: [
			'IntegrationService',
			'IikoQueueService',
			'IikoOrderExportQueueService',
			'MoySkladQueueService',
			'MoySkladOrderExportQueueService'
		]
	},
	{
		moduleName: 'inventory',
		serviceNames: ['InventoryService']
	},
	{
		moduleName: 'observability',
		serviceNames: ['ObservabilityService']
	},
	{
		moduleName: 's3',
		serviceNames: ['S3Service']
	},
	{
		moduleName: 'seo',
		serviceNames: ['SeoRepository']
	},
	{
		moduleName: 'product',
		serviceNames: ['ProductVariantCardProjectionService']
	}
] as const
const DTO_FREE_CONTRACT_MODULES = [
	'auth',
	'inventory',
	'product',
	'product-type'
] as const
const RESTRICTED_PUBLIC_INTERNAL_EXPORTS = [
	{
		moduleName: 'product',
		specifiers: [
			'./product-commercial-fields.mapper',
			'./product-price-list-read.utils',
			'./product-sale-units-read.utils',
			'./product-variant-card-projection'
		]
	}
] as const
const IMPORT_SPECIFIER_PATTERN =
	/\b(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g

type ImportEdge = {
	filePath: string
	resolvedPath: string | null
	specifier: string
	sourceModule: string
	targetModule: string | null
}

type BoundaryViolation = {
	filePath: string
	specifier: string
	sourceModule: string
	targetModule: string
	reason: string
}

type CoreModuleEntrypointViolation = {
	filePath: string
	specifier: string
	reason: string
}

type RestrictedModuleExportViolation = {
	filePath: string
	moduleName: string
	serviceName: string
	reason: string
}

type RestrictedContractImportViolation = {
	filePath: string
	moduleName: string
	specifier: string
	reason: string
}

type RestrictedPublicInternalExportViolation = {
	filePath: string
	moduleName: string
	specifier: string
	reason: string
}

function isTestFile(filePath: string): boolean {
	return (
		filePath.endsWith('.spec.ts') ||
		filePath.endsWith('.test.ts') ||
		filePath.endsWith('.spec.tsx') ||
		filePath.endsWith('.test.tsx')
	)
}

function isInsidePath(childPath: string, parentPath: string): boolean {
	const path = relative(parentPath, childPath)
	return (
		path === '' || (path !== '' && !path.startsWith('..') && !isAbsolute(path))
	)
}

function collectSourceFiles(dir: string): string[] {
	if (!existsSync(dir)) return []

	return readdirSync(dir).flatMap(entry => {
		const path = join(dir, entry)
		const stat = statSync(path)

		if (stat.isDirectory()) return collectSourceFiles(path)
		if (!SOURCE_EXTENSIONS.has(extname(path)) || isTestFile(path)) return []

		return [path]
	})
}

function extractImportSpecifiers(source: string): string[] {
	return Array.from(source.matchAll(IMPORT_SPECIFIER_PATTERN))
		.map(match => match[1] ?? match[2])
		.filter((specifier): specifier is string => Boolean(specifier))
}

function resolveImportSpecifier(
	filePath: string,
	specifier: string
): string | null {
	if (specifier.startsWith('@/')) {
		return resolve(WORKSPACE_ROOT, 'src', specifier.slice(2))
	}

	if (specifier.startsWith('.')) {
		return resolve(dirname(filePath), specifier)
	}

	return null
}

function getModuleName(filePath: string): string | null {
	const relativePath = relative(MODULES_ROOT, filePath)
	if (relativePath.startsWith('..') || isAbsolute(relativePath)) return null

	return relativePath.split(sep)[0] || null
}

function collectImportEdges(): ImportEdge[] {
	return collectSourceFiles(MODULES_ROOT).flatMap(filePath => {
		const sourceModule = getModuleName(filePath)
		if (!sourceModule) return []

		const source = readFileSync(filePath, 'utf8')
		return extractImportSpecifiers(source).map(specifier => {
			const resolvedPath = resolveImportSpecifier(filePath, specifier)
			return {
				filePath,
				resolvedPath,
				specifier,
				sourceModule,
				targetModule: resolvedPath ? getModuleName(resolvedPath) : null
			}
		})
	})
}

function isAllowedCrossModuleImport(edge: ImportEdge): boolean {
	const targetPath = normalizePath(edge.resolvedPath ?? edge.specifier)
	const specifier = normalizePath(edge.specifier)

	if (
		targetPath.endsWith('/contracts') ||
		targetPath.endsWith('/contracts.ts')
	) {
		return true
	}

	if (targetPath.endsWith('/public') || targetPath.endsWith('/public.ts')) {
		return true
	}

	if (
		edge.targetModule === 'auth' &&
		(specifier.includes('/auth/decorators/') ||
			specifier.includes('/auth/guards/') ||
			specifier.includes('/auth/types/') ||
			specifier.includes('/auth/session/session.utils'))
	) {
		return true
	}

	return false
}

function collectBoundaryViolations(edges: ImportEdge[]): BoundaryViolation[] {
	return edges.flatMap(edge => {
		if (!edge.targetModule) return []
		if (edge.sourceModule === edge.targetModule) return []
		if (!edge.resolvedPath || !isInsidePath(edge.resolvedPath, MODULES_ROOT)) {
			return []
		}
		if (isAllowedCrossModuleImport(edge)) return []

		return [
			{
				filePath: relative(WORKSPACE_ROOT, edge.filePath),
				specifier: edge.specifier,
				sourceModule: edge.sourceModule,
				targetModule: edge.targetModule,
				reason: 'cross-module internal import'
			}
		]
	})
}

function collectCoreModuleEntrypointViolations(): CoreModuleEntrypointViolation[] {
	return collectSourceFiles(CORE_ROOT).flatMap(filePath => {
		const source = readFileSync(filePath, 'utf8')

		return extractImportSpecifiers(source).flatMap(specifier => {
			const resolvedPath = resolveImportSpecifier(filePath, specifier)
			if (!resolvedPath || !isInsidePath(resolvedPath, MODULES_ROOT)) {
				return []
			}

			const targetPath = normalizePath(resolvedPath)
			if (
				targetPath.endsWith('/contracts') ||
				targetPath.endsWith('/contracts.ts') ||
				targetPath.endsWith('/public') ||
				targetPath.endsWith('/public.ts')
			) {
				return []
			}

			return [
				{
					filePath: relative(WORKSPACE_ROOT, filePath),
					specifier,
					reason: 'core module import must use public.ts or contracts.ts'
				}
			]
		})
	})
}

function extractNestModuleExportsBlocks(source: string): string[] {
	return Array.from(source.matchAll(/\bexports\s*:\s*\[([\s\S]*?)\]/g)).map(
		match => match[1] ?? ''
	)
}

function collectRestrictedModuleMetadataExportViolations(): RestrictedModuleExportViolation[] {
	return RESTRICTED_PUBLIC_SERVICE_EXPORTS.flatMap(boundary => {
		const modulePath = resolve(
			MODULES_ROOT,
			boundary.moduleName,
			`${boundary.moduleName}.module.ts`
		)
		if (!existsSync(modulePath)) return []

		const exportsBlocks = extractNestModuleExportsBlocks(
			readFileSync(modulePath, 'utf8')
		)
		return boundary.serviceNames.flatMap(serviceName => {
			const servicePattern = new RegExp(`\\b${serviceName}\\b`)
			if (!exportsBlocks.some(block => servicePattern.test(block))) return []

			return [
				{
					filePath: relative(WORKSPACE_ROOT, modulePath),
					moduleName: boundary.moduleName,
					serviceName,
					reason: 'implementation service exported from Nest module metadata'
				}
			]
		})
	})
}

function collectDtoFreeContractImportViolations(): RestrictedContractImportViolation[] {
	return DTO_FREE_CONTRACT_MODULES.flatMap(moduleName => {
		const contractsPath = resolve(MODULES_ROOT, moduleName, 'contracts.ts')
		if (!existsSync(contractsPath)) return []

		const source = readFileSync(contractsPath, 'utf8')
		return extractImportSpecifiers(source).flatMap(specifier => {
			const normalizedSpecifier = normalizePath(specifier)
			if (!normalizedSpecifier.includes('/dto/')) return []

			return [
				{
					filePath: relative(WORKSPACE_ROOT, contractsPath),
					moduleName,
					specifier,
					reason: 'application contract must not import HTTP DTO classes'
				}
			]
		})
	})
}

function collectRepositoryFreeContractImportViolations(): RestrictedContractImportViolation[] {
	return collectSourceFiles(MODULES_ROOT)
		.filter(filePath => filePath.endsWith(`${sep}contracts.ts`))
		.flatMap(contractsPath => {
			const moduleName = getModuleName(contractsPath) ?? 'unknown'
			const source = readFileSync(contractsPath, 'utf8')
			return extractImportSpecifiers(source).flatMap(specifier => {
				const normalizedSpecifier = normalizePath(specifier)
				if (!normalizedSpecifier.includes('repository')) return []

				return [
					{
						filePath: relative(WORKSPACE_ROOT, contractsPath),
						moduleName,
						specifier,
						reason:
							'application contract must not import repository implementation types'
					}
				]
			})
		})
}

function collectRestrictedPublicInternalExportViolations(): RestrictedPublicInternalExportViolation[] {
	return RESTRICTED_PUBLIC_INTERNAL_EXPORTS.flatMap(boundary => {
		const publicPath = resolve(MODULES_ROOT, boundary.moduleName, 'public.ts')
		if (!existsSync(publicPath)) return []

		const source = readFileSync(publicPath, 'utf8')
		const exportedSpecifiers = new Set(
			extractImportSpecifiers(source).map(normalizePath)
		)

		return boundary.specifiers.flatMap(specifier => {
			if (!exportedSpecifiers.has(normalizePath(specifier))) return []

			return [
				{
					filePath: relative(WORKSPACE_ROOT, publicPath),
					moduleName: boundary.moduleName,
					specifier,
					reason: 'internal helper file exported from module public entrypoint'
				}
			]
		})
	})
}

function renderViolationReport(violations: BoundaryViolation[]): string {
	const rows = violations
		.slice(0, 100)
		.map(
			violation =>
				`- ${violation.filePath}: ${violation.sourceModule} -> ${violation.targetModule} via ${violation.specifier}`
		)
	const suffix =
		violations.length > rows.length
			? `\n...and ${violations.length - rows.length} more violation(s).`
			: ''

	return [
		`Backend architecture boundary report: ${violations.length} violation(s).`,
		'Allowed cross-module imports: contracts.ts, public.ts, shared/core infra, auth decorators/guards/types.',
		...rows,
		suffix
	]
		.filter(Boolean)
		.join('\n')
}

function renderCoreModuleEntrypointReport(
	violations: CoreModuleEntrypointViolation[]
): string {
	const rows = violations.map(
		violation =>
			`- ${violation.filePath}: ${violation.specifier} (${violation.reason})`
	)

	return [
		`Backend core module entrypoint report: ${violations.length} violation(s).`,
		'Core imports from src/modules must use public.ts or contracts.ts.',
		...rows
	].join('\n')
}

function renderRestrictedModuleExportReport(
	violations: RestrictedModuleExportViolation[]
): string {
	const rows = violations.map(
		violation =>
			`- ${violation.filePath}: ${violation.moduleName} exports ${violation.serviceName} (${violation.reason})`
	)

	return [
		`Backend module metadata export report: ${violations.length} violation(s).`,
		'Selected modules must export DI tokens/contracts instead of implementation services.',
		...rows
	].join('\n')
}

function renderRestrictedContractImportReport(
	violations: RestrictedContractImportViolation[]
): string {
	const rows = violations.map(
		violation =>
			`- ${violation.filePath}: ${violation.moduleName} imports ${violation.specifier} (${violation.reason})`
	)

	return [
		`Backend contract DTO import report: ${violations.length} violation(s).`,
		'Selected application contracts must use structural input/output types instead of HTTP DTO classes.',
		...rows
	].join('\n')
}

function renderRestrictedContractRepositoryImportReport(
	violations: RestrictedContractImportViolation[]
): string {
	const rows = violations.map(
		violation =>
			`- ${violation.filePath}: ${violation.moduleName} imports ${violation.specifier} (${violation.reason})`
	)

	return [
		`Backend contract repository import report: ${violations.length} violation(s).`,
		'Selected application contracts must use public structural types instead of repository implementation types.',
		...rows
	].join('\n')
}

function renderRestrictedPublicInternalExportReport(
	violations: RestrictedPublicInternalExportViolation[]
): string {
	const rows = violations.map(
		violation =>
			`- ${violation.filePath}: ${violation.moduleName} exports ${violation.specifier} (${violation.reason})`
	)

	return [
		`Backend public internal export report: ${violations.length} violation(s).`,
		'Selected module public entrypoints must expose contracts/read utilities instead of internal helper files.',
		...rows
	].join('\n')
}

function normalizePath(value: string): string {
	return value.replace(/\\/g, '/')
}

describe('backend architecture boundaries', () => {
	it('reports cross-module internal imports', () => {
		const violations = collectBoundaryViolations(collectImportEdges())
		const report = renderViolationReport(violations)

		if (violations.length > 0) {
			process.stderr.write(`${report}\n`)
		}

		expect(violations).toEqual([])
	})

	it('keeps core imports on module public entrypoints', () => {
		const violations = collectCoreModuleEntrypointViolations()
		const report = renderCoreModuleEntrypointReport(violations)

		if (violations.length > 0) {
			process.stderr.write(`${report}\n`)
		}

		expect(violations).toEqual([])
	})

	it('keeps implementation services out of selected public barrels', () => {
		for (const boundary of RESTRICTED_PUBLIC_SERVICE_EXPORTS) {
			const publicSource = readFileSync(
				resolve(MODULES_ROOT, boundary.moduleName, 'public.ts'),
				'utf8'
			)

			for (const serviceName of boundary.serviceNames) {
				expect(publicSource).not.toMatch(
					new RegExp(`export\\s+\\{[^}]*\\b${serviceName}\\b`)
				)
			}
		}
	})

	it('keeps selected internal helper files out of public barrels', () => {
		const violations = collectRestrictedPublicInternalExportViolations()
		const report = renderRestrictedPublicInternalExportReport(violations)

		if (violations.length > 0) {
			process.stderr.write(`${report}\n`)
		}

		expect(violations).toEqual([])
	})

	it('keeps implementation services out of selected Nest module exports', () => {
		const violations = collectRestrictedModuleMetadataExportViolations()
		const report = renderRestrictedModuleExportReport(violations)

		if (violations.length > 0) {
			process.stderr.write(`${report}\n`)
		}

		expect(violations).toEqual([])
	})

	it('keeps selected application contracts free of HTTP DTO imports', () => {
		const violations = collectDtoFreeContractImportViolations()
		const report = renderRestrictedContractImportReport(violations)

		if (violations.length > 0) {
			process.stderr.write(`${report}\n`)
		}

		expect(violations).toEqual([])
	})

	it('keeps selected application contracts free of repository imports', () => {
		const violations = collectRepositoryFreeContractImportViolations()
		const report = renderRestrictedContractRepositoryImportReport(violations)

		if (violations.length > 0) {
			process.stderr.write(`${report}\n`)
		}

		expect(violations).toEqual([])
	})
})
