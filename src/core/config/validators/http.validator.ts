import { IsInt, IsString } from 'class-validator'

export class HttpValidator {
	@IsInt()
	HTTP_PORT: number

	@IsString()
	HTTP_HOST: string

	@IsString()
	HTTP_CORS: string
}
