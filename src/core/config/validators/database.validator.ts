import { IsInt, IsString, Max, Min } from 'class-validator'

export class DatabaseValidator {
	@IsString()
	DATABASE_USER: string

	@IsString()
	DATABASE_PASSWORD: string

	@IsString()
	DATABASE_HOST: string

	@IsInt()
	@Min(1)
	@Max(65535)
	DATABASE_PORT: number

	@IsString()
	DATABASE_NAME: string
}
