console.error(
	[
		'prisma:push is disabled for this project.',
		'Use npm run prisma:migrate:dev -- --name <name> for schema changes.',
		'Use npm run prisma:migrate:deploy for production deploys.',
		'For a disposable local database only, run npm run prisma:push:unsafe.'
	].join('\n')
)

process.exitCode = 1
