import { registerAs } from '@nestjs/config'

import { validateEnv } from '@/shared/utils'

import { HttpInterface } from '../interfaces/http.interface'
import { HttpValidator } from '../validators'

export const httpEnv = registerAs<HttpInterface>('http', () => {
	validateEnv(process.env, HttpValidator)

	return {
		port: parseInt(process.env.HTTP_PORT),
		host: process.env.HTTP_HOST,
		cors: process.env.HTTP_CORS
	}
})
