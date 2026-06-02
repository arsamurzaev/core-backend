import { PrismaPg } from '@prisma/adapter-pg'
import { hash } from 'argon2'
import 'dotenv/config'
import { stdin as input, stdout as output } from 'node:process'
import { createInterface } from 'node:readline/promises'

import { PrismaClient, Role } from '../prisma/generated/client.js'

const prisma = new PrismaClient({
	adapter: new PrismaPg({
		user: process.env.DATABASE_USER,
		password: process.env.DATABASE_PASSWORD,
		host: process.env.DATABASE_HOST,
		port: Number.parseInt(process.env.DATABASE_PORT || '5432', 10),
		database: process.env.DATABASE_NAME
	})
})

const rl = createInterface({ input, output })

async function main() {
	validateDatabaseEnv()

	const name = await askRequired('Name', 'Administrator')
	const login = await askRequired('Login')
	const role = await askRole()
	const password = await askPassword('Password')
	const passwordConfirmation = await askPassword('Repeat password')

	if (password !== passwordConfirmation) {
		throw new Error('Passwords do not match')
	}

	const passwordHash = await hash(password)
	const existing = await prisma.user.findUnique({
		where: {
			login_role: {
				login,
				role
			}
		},
		select: { id: true, login: true, name: true }
	})
	const geoBindings =
		role === Role.GEO_ADMIN ? await askGeoAdminBindings() : null

	if (existing) {
		const shouldUpdate = await askYesNo(
			`${role} "${login}" already exists. Update name, password and bindings?`
		)
		if (!shouldUpdate) {
			console.log('Cancelled')
			return
		}

		const admin = await prisma.user.update({
			where: { id: existing.id },
			data: {
				name,
				password: passwordHash,
				isEmailConfirmed: true,
				deleteAt: null,
				...(geoBindings
					? {
							countries: { set: geoBindings.countryIds.map(id => ({ id })) },
							regions: { set: geoBindings.regionalityIds.map(id => ({ id })) }
						}
					: {})
			},
			select: { id: true, login: true, name: true, role: true }
		})

		console.log(`Admin updated: ${admin.login} (${admin.id})`)
		return
	}

	const admin = await prisma.user.create({
		data: {
			name,
			login,
			password: passwordHash,
			role,
			isEmailConfirmed: true,
			...(geoBindings
				? {
						countries: { connect: geoBindings.countryIds.map(id => ({ id })) },
						regions: { connect: geoBindings.regionalityIds.map(id => ({ id })) }
					}
				: {})
		},
		select: { id: true, login: true, name: true, role: true }
	})

	console.log(`${role} created: ${admin.login} (${admin.id})`)
}

async function askRequired(
	label: string,
	defaultValue?: string
): Promise<string> {
	const suffix = defaultValue ? ` (${defaultValue})` : ''
	const value = (await rl.question(`${label}${suffix}: `)).trim()
	const resolved = value || defaultValue

	if (!resolved) {
		throw new Error(`${label} is required`)
	}

	return resolved
}

async function askYesNo(label: string): Promise<boolean> {
	const answer = (await rl.question(`${label} [y/N]: `)).trim().toLowerCase()
	return answer === 'y' || answer === 'yes'
}

async function askPassword(label: string): Promise<string> {
	const value = (await rl.question(`${label}: `)).trim()
	if (!value) throw new Error(`${label} is required`)
	return value
}

async function askRole(): Promise<Role> {
	const value = (await rl.question('Role ADMIN/GEO_ADMIN (ADMIN): '))
		.trim()
		.toUpperCase()

	if (!value || value === Role.ADMIN) return Role.ADMIN
	if (value === Role.GEO_ADMIN) return Role.GEO_ADMIN

	throw new Error('Role must be ADMIN or GEO_ADMIN')
}

async function askGeoAdminBindings() {
	const countryIds = parseCsvIds(
		await rl.question('Country ids, comma separated (optional): ')
	)
	const regionalityIds = parseCsvIds(
		await rl.question('Regionality ids, comma separated (optional): ')
	)

	if (!countryIds.length && !regionalityIds.length) {
		throw new Error('GEO_ADMIN requires at least one country or regionality id')
	}

	return { countryIds, regionalityIds }
}

function parseCsvIds(value: string) {
	return Array.from(
		new Set(
			value
				.split(',')
				.map(item => item.trim())
				.filter(Boolean)
		)
	)
}

function validateDatabaseEnv() {
	const missing = [
		'DATABASE_USER',
		'DATABASE_PASSWORD',
		'DATABASE_HOST',
		'DATABASE_NAME'
	].filter(key => !process.env[key])

	if (missing.length) {
		throw new Error(`Missing database env vars: ${missing.join(', ')}`)
	}
}

main()
	.catch(error => {
		console.error(error instanceof Error ? error.message : error)
		process.exitCode = 1
	})
	.finally(async () => {
		rl.close()
		await prisma.$disconnect()
	})
