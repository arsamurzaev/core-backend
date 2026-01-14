import { registerAs } from '@nestjs/config'

import { validateEnv } from '@/shared/utils'

import { DatabaseInterface } from '../interfaces/database.interface'
import { DatabaseValidator } from '../validators'

export const databaseEnv = registerAs<DatabaseInterface>('database', () => {
	validateEnv(process.env, DatabaseValidator)

	return {
		user: process.env.DATABASE_USER,
		password: process.env.DATABASE_PASSWORD,
		host: process.env.DATABASE_HOST,
		port: parseInt(process.env.DATABASE_PORT),
		name: process.env.DATABASE_NAME
	}
})
