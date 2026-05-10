import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '../../prisma/generated/client.js'

export function createPrismaClient() {
	const connectionString = process.env.DATABASE_URI ?? process.env.DATABASE_URL

	return new PrismaClient({
		adapter: new PrismaPg(
			connectionString
				? { connectionString }
				: {
						user: process.env.DATABASE_USER,
						password: process.env.DATABASE_PASSWORD,
						host: process.env.DATABASE_HOST,
						port: Number.parseInt(process.env.DATABASE_PORT || '5432', 10),
						database: process.env.DATABASE_NAME
					}
		)
	})
}

export function validateDatabaseEnv() {
	if (process.env.DATABASE_URI || process.env.DATABASE_URL) return

	const missing = [
		'DATABASE_USER',
		'DATABASE_PASSWORD',
		'DATABASE_HOST',
		'DATABASE_NAME'
	].filter(key => !process.env[key])

	if (missing.length) {
		throw new Error(
			`Не хватает переменных базы: ${missing.join(', ')} или DATABASE_URI`
		)
	}
}
