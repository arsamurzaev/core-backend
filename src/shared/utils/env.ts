import { ClassConstructor, plainToClass } from 'class-transformer'
import { validateSync } from 'class-validator'

export function validateEnv<T extends object>(
	config: Record<string, string | undefined>,
	envVariablesClass: ClassConstructor<T>
) {
	const validatedConfig = plainToClass(envVariablesClass, config, {
		enableImplicitConversion: true
	})

	const errors = validateSync(validatedConfig, {
		skipMissingProperties: false
	})

	if (errors.length > 0) {
		const message = errors
			.map(
				error =>
					`\nОшибка в ${error.property}:\n` +
					Object.entries(error.constraints)
						.map(([key, value]) => `${key}: ${value}`)
						.join('\n')
			)
			.join('\n')

		console.log(`\n${errors.toString()}`)

		throw new Error(message)
	}

	return validatedConfig
}
