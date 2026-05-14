import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import 'dotenv/config'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { AppModule } from '../src/core/app.module'
import { getValidationPipeConfig } from '../src/core/config/cfg'
import { createOpenApiDocument } from '../src/openapi'

const DEFAULT_OUTPUT_PATH = 'runtime/openapi.json'

function getOutputPath(args: string[]): string {
	const value = args.find(arg => arg.startsWith('--output='))
	if (!value) return DEFAULT_OUTPUT_PATH

	const outputPath = value.slice('--output='.length).trim()
	if (!outputPath) {
		throw new Error('--output must not be empty')
	}

	return outputPath
}

async function main() {
	const outputPath = resolve(process.cwd(), getOutputPath(process.argv.slice(2)))
	const app = await NestFactory.create(AppModule, {
		bodyParser: false,
		logger: false
	})

	try {
		app.useGlobalPipes(new ValidationPipe(getValidationPipeConfig()))

		const document = createOpenApiDocument(app)
		await mkdir(dirname(outputPath), { recursive: true })
		await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
		console.log(`OpenAPI document exported to ${outputPath}`)
	} finally {
		await app.close()
	}
}

main().catch(error => {
	console.error(error instanceof Error ? (error.stack ?? error.message) : error)
	process.exitCode = 1
})
