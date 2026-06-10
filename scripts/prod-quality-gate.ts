import { spawn } from 'node:child_process'
import process from 'node:process'

type GateOptions = {
	fast: boolean
	skipDb: boolean
	skipOpenApi: boolean
}

type GateStep = {
	name: string
	command: string
	args: string[]
}

const NPM_BIN = process.platform === 'win32' ? 'npm.cmd' : 'npm'

async function main() {
	const options = parseOptions(process.argv.slice(2))
	const steps = buildSteps(options)
	const startedAt = Date.now()

	console.log('Backend prod quality gate')
	console.log(
		`mode=${options.fast ? 'fast' : 'full'} skipOpenApi=${options.skipOpenApi} skipDb=${options.skipDb}`
	)

	for (const [index, step] of steps.entries()) {
		const number = `${index + 1}/${steps.length}`
		await runStep(number, step)
	}

	console.log(
		`\nQuality gate passed in ${formatDuration(Date.now() - startedAt)}.`
	)
}

function buildSteps(options: GateOptions): GateStep[] {
	const steps: GateStep[] = [
		npmStep('Prisma generate', ['run', 'prisma:generate']),
		npmStep('Build', ['run', 'build'])
	]

	if (!options.skipOpenApi) {
		steps.push(
			npmStep('OpenAPI export', [
				'run',
				'openapi:export',
				'--',
				'--output=runtime/openapi.json'
			])
		)
	}

	if (options.fast) {
		steps.push(
			npmStep('Focused tests', [
				'test',
				'--',
				'architecture',
				'product',
				'cart',
				'inventory',
				'integration',
				'--runInBand'
			])
		)
	} else {
		steps.push(npmStep('Full tests', ['test', '--', '--runInBand']))
	}

	if (!options.skipDb) {
		steps.push(
			npmStep('Default variant data audit', ['run', 'db:audit-default-variants'])
		)
	}

	return steps
}

function npmStep(name: string, args: string[]): GateStep {
	return {
		name,
		command: NPM_BIN,
		args
	}
}

async function runStep(number: string, step: GateStep): Promise<void> {
	const startedAt = Date.now()
	console.log(`\n[${number}] ${step.name}`)
	console.log(`$ ${[step.command, ...step.args].join(' ')}`)

	const code = await spawnStep(step)
	const duration = formatDuration(Date.now() - startedAt)
	if (code === 0) {
		console.log(`[${number}] ${step.name} passed in ${duration}`)
		return
	}

	throw new Error(`${step.name} failed with exit code ${code} after ${duration}`)
}

function spawnStep(step: GateStep): Promise<number | null> {
	return new Promise((resolve, reject) => {
		const child = spawn(step.command, step.args, {
			cwd: process.cwd(),
			env: process.env,
			stdio: 'inherit',
			shell: false
		})

		child.on('error', reject)
		child.on('close', code => resolve(code))
	})
}

function parseOptions(args: string[]): GateOptions {
	return {
		fast: args.includes('--fast'),
		skipDb: args.includes('--skip-db'),
		skipOpenApi: args.includes('--skip-openapi')
	}
}

function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.round(ms / 1000))
	const minutes = Math.floor(totalSeconds / 60)
	const seconds = totalSeconds % 60
	if (minutes <= 0) return `${seconds}s`
	return `${minutes}m ${seconds}s`
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : error)
	process.exitCode = 1
})
