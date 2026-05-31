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
const SOURCE_EXTENSIONS = new Set(['.ts'])
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
})
