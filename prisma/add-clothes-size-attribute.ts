import { PrismaPg } from '@prisma/adapter-pg'
import { parse } from 'dotenv'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { DataType, PrismaClient } from './generated/client.js'

const TARGET_TYPE_CODE = process.env.CLOTHES_TYPE_CODE?.trim() || 'clothes'
const TARGET_TYPE_NAME = process.env.CLOTHES_TYPE_NAME?.trim() || 'Одежда'
const ATTRIBUTE_KEY = 'size'
const ATTRIBUTE_DISPLAY_NAME = 'Размер'
const SIZE_VALUES = [
	{ value: 'xs', displayName: 'XS' },
	{ value: 's', displayName: 'S' },
	{ value: 'm', displayName: 'M' },
	{ value: 'l', displayName: 'L' },
	{ value: 'xl', displayName: 'XL' }
]

loadEnvFiles()

const databaseUrl = process.env.DATABASE_URI ?? process.env.DATABASE_URL

if (!databaseUrl) {
	throw new Error('DATABASE_URI or DATABASE_URL is not set')
}

const prisma = new PrismaClient({
	adapter: new PrismaPg({
		connectionString: databaseUrl
	})
})

async function main() {
	const result = await prisma.$transaction(async tx => {
		const type = await tx.type.upsert({
			where: { code: TARGET_TYPE_CODE },
			create: {
				code: TARGET_TYPE_CODE,
				name: TARGET_TYPE_NAME
			},
			update: {
				name: TARGET_TYPE_NAME,
				deleteAt: null
			}
		})

		const connectedAttribute = await tx.attribute.findFirst({
			where: {
				key: ATTRIBUTE_KEY,
				types: { some: { id: type.id } }
			},
			orderBy: { createdAt: 'asc' }
		})

		const reusableAttribute =
			connectedAttribute ??
			(await tx.attribute.findFirst({
				where: {
					key: ATTRIBUTE_KEY,
					types: { none: {} }
				},
				orderBy: { createdAt: 'asc' }
			}))

		const attribute = reusableAttribute
			? await tx.attribute.update({
					where: { id: reusableAttribute.id },
					data: {
						displayName: ATTRIBUTE_DISPLAY_NAME,
						dataType: DataType.ENUM,
						isRequired: true,
						isVariantAttribute: true,
						isFilterable: true,
						displayOrder: 2,
						isHidden: false,
						deleteAt: null,
						...(connectedAttribute ? {} : { types: { connect: [{ id: type.id }] } })
					}
				})
			: await tx.attribute.create({
					data: {
						key: ATTRIBUTE_KEY,
						displayName: ATTRIBUTE_DISPLAY_NAME,
						dataType: DataType.ENUM,
						isRequired: true,
						isVariantAttribute: true,
						isFilterable: true,
						displayOrder: 2,
						isHidden: false,
						types: { connect: [{ id: type.id }] }
					}
				})

		for (const [index, size] of SIZE_VALUES.entries()) {
			await tx.attributeEnumValue.upsert({
				where: {
					attributeId_value: {
						attributeId: attribute.id,
						value: size.value
					}
				},
				create: {
					attributeId: attribute.id,
					value: size.value,
					displayName: size.displayName,
					displayOrder: index + 1
				},
				update: {
					displayName: size.displayName,
					displayOrder: index + 1,
					deleteAt: null
				}
			})
		}

		const enumValues = await tx.attributeEnumValue.findMany({
			where: {
				attributeId: attribute.id,
				value: { in: SIZE_VALUES.map(size => size.value) }
			},
			orderBy: { displayOrder: 'asc' },
			select: {
				value: true,
				displayName: true,
				displayOrder: true
			}
		})

		return {
			typeCode: type.code,
			typeId: type.id,
			attributeId: attribute.id,
			attributeKey: attribute.key,
			enumValues
		}
	})

	console.log('Clothes size attribute is ready:', result)
}

function loadEnvFiles() {
	const protectedKeys = new Set(Object.keys(process.env))
	const envFiles = [
		'.env',
		path.join('migration', '.env'),
		path.join('migration', '.env.local')
	]

	for (const envFile of envFiles) {
		const absolutePath = path.resolve(process.cwd(), envFile)
		if (!existsSync(absolutePath)) continue

		const parsed = parse(readFileSync(absolutePath))
		for (const [key, value] of Object.entries(parsed)) {
			if (protectedKeys.has(key) && process.env[key] !== undefined) continue

			process.env[key] = value
		}
	}
}

main()
	.catch(error => {
		console.error('Failed to create clothes size attribute:', error)
		process.exitCode = 1
	})
	.finally(async () => {
		await prisma.$disconnect()
	})
