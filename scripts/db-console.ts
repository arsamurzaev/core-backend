import { runDbConsole } from './db-console/index.js'

runDbConsole().catch(error => {
	console.error(error instanceof Error ? error.message : error)
	process.exitCode = 1
})
