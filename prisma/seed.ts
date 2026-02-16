import { PrismaPg } from '@prisma/adapter-pg'
import { hash } from 'argon2'
import 'dotenv/config'

import {
	CatalogStatus,
	DataType,
	Prisma,
	PrismaClient,
	ProductStatus,
	ProductVariantStatus,
	Role
} from './generated/client.js'

const databaseUrl = process.env.DATABASE_URI ?? process.env.DATABASE_URL

if (!databaseUrl) {
	throw new Error('DATABASE_URI or DATABASE_URL is not set')
}

const prisma = new PrismaClient({
	adapter: new PrismaPg({
		user: process.env.DATABASE_USER,
		password: process.env.DATABASE_PASSWORD,
		host: process.env.DATABASE_HOST,
		port: Number.parseInt(process.env.DATABASE_PORT || '5432', 10),
		database: process.env.DATABASE_NAME
	})
})

type EnumValueSeed = {
	value: string
	displayName: string
}

type AttributeSeed = {
	key: string
	displayName: string
	dataType: DataType
	isRequired: boolean
	isVariantAttribute: boolean
	isFilterable: boolean
	displayOrder: number
	enumValues?: EnumValueSeed[]
}

type FrontTypeSeed = {
	code: string
	name: string
	uniqueAttribute: AttributeSeed
	variantAttribute: AttributeSeed
}

const commonProductAttributes: AttributeSeed[] = [
	{
		key: 'brand',
		displayName: 'Бренд',
		dataType: DataType.ENUM,
		isRequired: true,
		isVariantAttribute: false,
		isFilterable: true,
		displayOrder: 80
	},
	{
		key: 'subtitle',
		displayName: 'Подзаголовок',
		dataType: DataType.STRING,
		isRequired: false,
		isVariantAttribute: false,
		isFilterable: false,
		displayOrder: 81
	},
	{
		key: 'about',
		displayName: 'О товаре',
		dataType: DataType.STRING,
		isRequired: false,
		isVariantAttribute: false,
		isFilterable: false,
		displayOrder: 82
	},
	{
		key: 'description',
		displayName: 'Описание',
		dataType: DataType.STRING,
		isRequired: false,
		isVariantAttribute: false,
		isFilterable: false,
		displayOrder: 83
	},
	{
		key: 'discount',
		displayName: 'Скидка',
		dataType: DataType.INTEGER,
		isRequired: false,
		isVariantAttribute: false,
		isFilterable: false,
		displayOrder: 84
	},
	{
		key: 'discountedPrice',
		displayName: 'Цена со скидкой',
		dataType: DataType.DECIMAL,
		isRequired: false,
		isVariantAttribute: false,
		isFilterable: false,
		displayOrder: 85
	},
	{
		key: 'discountStartAt',
		displayName: 'Скидка с',
		dataType: DataType.DATETIME,
		isRequired: false,
		isVariantAttribute: false,
		isFilterable: false,
		displayOrder: 86
	},
	{
		key: 'discountEndAt',
		displayName: 'Скидка до',
		dataType: DataType.DATETIME,
		isRequired: false,
		isVariantAttribute: false,
		isFilterable: false,
		displayOrder: 87
	}
]

// Типы взяты с фронта: frontend/plugins/schemas/component-schema.ts
const frontendTypes: FrontTypeSeed[] = [
	{
		code: 'food',
		name: 'Еда и напитки',
		uniqueAttribute: {
			key: 'food_kitchen_style',
			displayName: 'Кухня',
			dataType: DataType.STRING,
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 1
		},
		variantAttribute: {
			key: 'food_portion_size',
			displayName: 'Размер порции',
			dataType: DataType.ENUM,
			isRequired: true,
			isVariantAttribute: true,
			isFilterable: true,
			displayOrder: 2,
			enumValues: [
				{ value: 'small', displayName: 'Маленькая' },
				{ value: 'medium', displayName: 'Средняя' },
				{ value: 'large', displayName: 'Большая' }
			]
		}
	},
	{
		code: 'beauty',
		name: 'Красота и здоровье',
		uniqueAttribute: {
			key: 'beauty_specialization',
			displayName: 'Специализация',
			dataType: DataType.STRING,
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 1
		},
		variantAttribute: {
			key: 'beauty_session_duration',
			displayName: 'Длительность сеанса',
			dataType: DataType.ENUM,
			isRequired: true,
			isVariantAttribute: true,
			isFilterable: true,
			displayOrder: 2,
			enumValues: [
				{ value: '30m', displayName: '30 минут' },
				{ value: '45m', displayName: '45 минут' },
				{ value: '60m', displayName: '60 минут' }
			]
		}
	},
	{
		code: 'cloth',
		name: 'Одежда и стиль',
		uniqueAttribute: {
			key: 'cloth_material',
			displayName: 'Материал',
			dataType: DataType.STRING,
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 1
		},
		variantAttribute: {
			key: 'outerwear_size',
			displayName: 'Размерный ряд верхней одежды',
			dataType: DataType.ENUM,
			isRequired: true,
			isVariantAttribute: true,
			isFilterable: true,
			displayOrder: 2,
			enumValues: [
				{ value: 'xxs', displayName: 'XXS' },
				{ value: 'xs', displayName: 'XS' },
				{ value: 's', displayName: 'S' },
				{ value: 'm', displayName: 'M' },
				{ value: 'l', displayName: 'L' },
				{ value: 'xl', displayName: 'XL' },
				{ value: 'xxl', displayName: 'XXL' }
			]
		}
	},
	{
		code: 'gifts',
		name: 'Подарки, цветы и хобби',
		uniqueAttribute: {
			key: 'gifts_occasion',
			displayName: 'Повод',
			dataType: DataType.STRING,
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 1
		},
		variantAttribute: {
			key: 'gifts_bundle_size',
			displayName: 'Размер набора',
			dataType: DataType.ENUM,
			isRequired: true,
			isVariantAttribute: true,
			isFilterable: true,
			displayOrder: 2,
			enumValues: [
				{ value: 'mini', displayName: 'Мини' },
				{ value: 'standard', displayName: 'Стандарт' },
				{ value: 'premium', displayName: 'Премиум' }
			]
		}
	},
	{
		code: 'cafe',
		name: 'Рестораны и кофейни',
		uniqueAttribute: {
			key: 'cafe_bean_origin',
			displayName: 'Происхождение зерна',
			dataType: DataType.STRING,
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 1
		},
		variantAttribute: {
			key: 'cafe_cup_size',
			displayName: 'Объём стакана',
			dataType: DataType.ENUM,
			isRequired: true,
			isVariantAttribute: true,
			isFilterable: true,
			displayOrder: 2,
			enumValues: [
				{ value: '250ml', displayName: '250 мл' },
				{ value: '350ml', displayName: '350 мл' },
				{ value: '450ml', displayName: '450 мл' }
			]
		}
	},
	{
		code: 'tech',
		name: 'Техника и сервисы',
		uniqueAttribute: {
			key: 'tech_warranty_months',
			displayName: 'Гарантия (месяцев)',
			dataType: DataType.INTEGER,
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 1
		},
		variantAttribute: {
			key: 'tech_memory_size',
			displayName: 'Объём памяти',
			dataType: DataType.ENUM,
			isRequired: true,
			isVariantAttribute: true,
			isFilterable: true,
			displayOrder: 2,
			enumValues: [
				{ value: '128gb', displayName: '128 ГБ' },
				{ value: '256gb', displayName: '256 ГБ' },
				{ value: '512gb', displayName: '512 ГБ' }
			]
		}
	},
	{
		code: 'home',
		name: 'Товары для дома и офиса',
		uniqueAttribute: {
			key: 'home_care_type',
			displayName: 'Тип ухода',
			dataType: DataType.STRING,
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 1
		},
		variantAttribute: {
			key: 'home_pack_volume',
			displayName: 'Объём упаковки',
			dataType: DataType.ENUM,
			isRequired: true,
			isVariantAttribute: true,
			isFilterable: true,
			displayOrder: 2,
			enumValues: [
				{ value: '500ml', displayName: '500 мл' },
				{ value: '1l', displayName: '1 л' },
				{ value: '2l', displayName: '2 л' }
			]
		}
	},
	{
		code: 'trade',
		name: 'Торговые базы',
		uniqueAttribute: {
			key: 'trade_manufacturer_code',
			displayName: 'Код производителя',
			dataType: DataType.STRING,
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 1
		},
		variantAttribute: {
			key: 'trade_pack_count',
			displayName: 'Количество в упаковке',
			dataType: DataType.ENUM,
			isRequired: true,
			isVariantAttribute: true,
			isFilterable: true,
			displayOrder: 2,
			enumValues: [
				{ value: '1', displayName: '1 шт' },
				{ value: '5', displayName: '5 шт' },
				{ value: '10', displayName: '10 шт' }
			]
		}
	}
]

const brandEnumValues: EnumValueSeed[] = [
	{ value: 'alpha', displayName: 'Alpha' },
	{ value: 'nova', displayName: 'Nova' },
	{ value: 'prime', displayName: 'Prime' }
]

async function clearDatabase() {
	await prisma.$transaction([
		prisma.analyticsEvent.deleteMany(),
		prisma.lead.deleteMany(),
		prisma.analyticsSession.deleteMany(),
		prisma.metrikaSourceDailyStat.deleteMany(),
		prisma.metrikaDailyStat.deleteMany(),
		prisma.cartItem.deleteMany(),
		prisma.cart.deleteMany(),
		prisma.orderItem.deleteMany(),
		prisma.order.deleteMany(),
		prisma.variantAttribute.deleteMany(),
		prisma.productVariant.deleteMany(),
		prisma.productAttribute.deleteMany(),
		prisma.attributeEnumValue.deleteMany(),
		prisma.attribute.deleteMany(),
		prisma.categoryProduct.deleteMany(),
		prisma.productMedia.deleteMany(),
		prisma.product.deleteMany(),
		prisma.category.deleteMany(),
		prisma.seoSetting.deleteMany(),
		prisma.catalogContact.deleteMany(),
		prisma.catalogConfig.deleteMany(),
		prisma.catalogSettings.deleteMany(),
		prisma.payment.deleteMany(),
		prisma.metrics.deleteMany(),
		prisma.mediaVariant.deleteMany(),
		prisma.media.deleteMany(),
		prisma.integration.deleteMany(),
		prisma.s3.deleteMany(),
		prisma.catalog.deleteMany(),
		prisma.activity.deleteMany(),
		prisma.type.deleteMany(),
		prisma.user.deleteMany(),
		prisma.regionality.deleteMany()
	])
}

function variantSkuSegment(value: string): string {
	const normalized = value.replace(/[^a-zA-Z0-9]+/g, '').toUpperCase()
	return normalized.length > 0 ? normalized : 'VAR'
}

async function createCommonAttributes(typeIds: string[]) {
	const created = await Promise.all(
		commonProductAttributes.map(attribute =>
			prisma.attribute.create({
				data: {
					key: attribute.key,
					displayName: attribute.displayName,
					dataType: attribute.dataType,
					isRequired: attribute.isRequired,
					isVariantAttribute: attribute.isVariantAttribute,
					isFilterable: attribute.isFilterable,
					displayOrder: attribute.displayOrder,
					types: {
						connect: typeIds.map(id => ({ id }))
					}
				}
			})
		)
	)

	return Object.fromEntries(created.map(attribute => [attribute.key, attribute]))
}

async function main() {
	await clearDatabase()

	const passwordHash = await hash('password')

	const defaultRegion = await prisma.regionality.create({
		data: { code: 'RU-MOW', name: 'Москва' }
	})

	const admin = await prisma.user.create({
		data: {
			name: 'Администратор',
			login: 'admin',
			password: passwordHash,
			role: Role.ADMIN,
			isEmailConfirmed: true,
			regions: { connect: [{ id: defaultRegion.id }] }
		}
	})

	const catalogOwner = await prisma.user.create({
		data: {
			name: 'Владелец каталогов',
			login: 'catalog-owner',
			password: passwordHash,
			role: Role.CATALOG,
			isEmailConfirmed: true,
			regions: { connect: [{ id: defaultRegion.id }] }
		}
	})

	const activity = await prisma.activity.create({
		data: { name: 'Онлайн-каталог' }
	})

	const types = await Promise.all(
		frontendTypes.map(typeSeed =>
			prisma.type.create({
				data: {
					code: typeSeed.code,
					name: typeSeed.name,
					activities: { connect: [{ id: activity.id }] }
				}
			})
		)
	)

	const typeByCode = Object.fromEntries(types.map(type => [type.code, type]))
	const commonAttributes = await createCommonAttributes(
		types.map(type => type.id)
	)

	await prisma.attributeEnumValue.createMany({
		data: brandEnumValues.map((item, index) => ({
			attributeId: commonAttributes.brand.id,
			value: item.value,
			displayName: item.displayName,
			displayOrder: index + 1
		}))
	})

	const brandValues = await prisma.attributeEnumValue.findMany({
		where: { attributeId: commonAttributes.brand.id },
		orderBy: { displayOrder: 'asc' }
	})

	const now = new Date()
	const discountStartAt = new Date(now.getTime() - 24 * 60 * 60 * 1000)
	const discountEndAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

	const createdCatalogs: string[] = []

	for (const [index, typeSeed] of frontendTypes.entries()) {
		const type = typeByCode[typeSeed.code]
		if (!type) continue

		const uniqueAttribute = await prisma.attribute.create({
			data: {
				key: typeSeed.uniqueAttribute.key,
				displayName: typeSeed.uniqueAttribute.displayName,
				dataType: typeSeed.uniqueAttribute.dataType,
				isRequired: typeSeed.uniqueAttribute.isRequired,
				isVariantAttribute: false,
				isFilterable: typeSeed.uniqueAttribute.isFilterable,
				displayOrder: typeSeed.uniqueAttribute.displayOrder,
				types: { connect: [{ id: type.id }] }
			}
		})

		const variantAttribute = await prisma.attribute.create({
			data: {
				key: typeSeed.variantAttribute.key,
				displayName: typeSeed.variantAttribute.displayName,
				dataType: DataType.ENUM,
				isRequired: true,
				isVariantAttribute: true,
				isFilterable: typeSeed.variantAttribute.isFilterable,
				displayOrder: typeSeed.variantAttribute.displayOrder,
				types: { connect: [{ id: type.id }] }
			}
		})

		const variantEnumSeed = typeSeed.variantAttribute.enumValues ?? []
		if (!variantEnumSeed.length) {
			throw new Error(
				`Variant enum values are required for type "${typeSeed.code}"`
			)
		}

		await prisma.attributeEnumValue.createMany({
			data: variantEnumSeed.map((item, enumIndex) => ({
				attributeId: variantAttribute.id,
				value: item.value,
				displayName: item.displayName,
				displayOrder: enumIndex + 1
			}))
		})

		const variantEnumValues = await prisma.attributeEnumValue.findMany({
			where: { attributeId: variantAttribute.id },
			orderBy: { displayOrder: 'asc' }
		})

		const catalog = await prisma.catalog.create({
			data: {
				slug: `${type.code}-catalog`,
				domain: `${type.code}.catalog.local`,
				name: `${type.name} Demo`,
				typeId: type.id,
				userId: catalogOwner.id,
				config: {
					create: {
						status: CatalogStatus.OPERATIONAL,
						about: `Демо-каталог: ${type.name}`,
						description: `Каталог для типа ${type.code}`,
						currency: '₽'
					}
				},
				settings: {
					create: {
						isActive: true
					}
				}
			}
		})

		createdCatalogs.push(catalog.slug)

		const category = await prisma.category.create({
			data: {
				catalogId: catalog.id,
				name: 'Основное',
				position: 0
			}
		})

		const basePrice = new Prisma.Decimal(990 + index * 120)
		const discount = 10
		const discountedPrice = basePrice
			.mul(new Prisma.Decimal(100 - discount))
			.div(100)
			.toDecimalPlaces(2)

		const product = await prisma.product.create({
			data: {
				catalogId: catalog.id,
				sku: `${type.code.toUpperCase()}-001`,
				name: `${type.name} товар`,
				slug: `${type.code}-product-1`,
				price: basePrice,
				status: ProductStatus.ACTIVE,
				isPopular: true,
				position: 0
			}
		})

		await prisma.categoryProduct.create({
			data: {
				categoryId: category.id,
				productId: product.id,
				position: 0
			}
		})

		const selectedBrand = brandValues[index % brandValues.length]

		await prisma.productAttribute.create({
			data: {
				productId: product.id,
				attributeId: commonAttributes.brand.id,
				enumValueId: selectedBrand.id
			}
		})

		await prisma.productAttribute.create({
			data: {
				productId: product.id,
				attributeId: commonAttributes.subtitle.id,
				valueString: `${product.name} — подзаголовок`
			}
		})

		await prisma.productAttribute.create({
			data: {
				productId: product.id,
				attributeId: commonAttributes.about.id,
				valueString: `Коротко о товаре "${product.name}".`
			}
		})

		await prisma.productAttribute.create({
			data: {
				productId: product.id,
				attributeId: commonAttributes.description.id,
				valueString: `Описание товара "${product.name}" для типа "${type.name}".`
			}
		})

		await prisma.productAttribute.create({
			data: {
				productId: product.id,
				attributeId: commonAttributes.discount.id,
				valueInteger: discount
			}
		})

		await prisma.productAttribute.create({
			data: {
				productId: product.id,
				attributeId: commonAttributes.discountedPrice.id,
				valueDecimal: discountedPrice
			}
		})

		await prisma.productAttribute.create({
			data: {
				productId: product.id,
				attributeId: commonAttributes.discountStartAt.id,
				valueDateTime: discountStartAt
			}
		})

		await prisma.productAttribute.create({
			data: {
				productId: product.id,
				attributeId: commonAttributes.discountEndAt.id,
				valueDateTime: discountEndAt
			}
		})

		const uniqueValueBase = `${type.name} значение`
		if (uniqueAttribute.dataType === DataType.INTEGER) {
			await prisma.productAttribute.create({
				data: {
					productId: product.id,
					attributeId: uniqueAttribute.id,
					valueInteger: 12
				}
			})
		} else if (uniqueAttribute.dataType === DataType.BOOLEAN) {
			await prisma.productAttribute.create({
				data: {
					productId: product.id,
					attributeId: uniqueAttribute.id,
					valueBoolean: true
				}
			})
		} else if (uniqueAttribute.dataType === DataType.DECIMAL) {
			await prisma.productAttribute.create({
				data: {
					productId: product.id,
					attributeId: uniqueAttribute.id,
					valueDecimal: new Prisma.Decimal('1.5')
				}
			})
		} else if (uniqueAttribute.dataType === DataType.DATETIME) {
			await prisma.productAttribute.create({
				data: {
					productId: product.id,
					attributeId: uniqueAttribute.id,
					valueDateTime: now
				}
			})
		} else {
			await prisma.productAttribute.create({
				data: {
					productId: product.id,
					attributeId: uniqueAttribute.id,
					valueString: uniqueValueBase
				}
			})
		}

		for (const [variantIndex, enumValue] of variantEnumValues
			.slice(0, 3)
			.entries()) {
			const status =
				variantIndex === 2
					? ProductVariantStatus.OUT_OF_STOCK
					: ProductVariantStatus.ACTIVE
			const stock = status === ProductVariantStatus.OUT_OF_STOCK ? 0 : 10

			const variant = await prisma.productVariant.create({
				data: {
					productId: product.id,
					sku: `${product.sku}-${variantSkuSegment(enumValue.value)}`,
					variantKey: `${variantAttribute.key}=${enumValue.value}`,
					stock,
					price: basePrice,
					status,
					isAvailable: status === ProductVariantStatus.ACTIVE
				}
			})

			await prisma.variantAttribute.create({
				data: {
					variantId: variant.id,
					attributeId: variantAttribute.id,
					enumValueId: enumValue.id
				}
			})
		}
	}

	console.log('Seed completed:', {
		users: [admin.login, catalogOwner.login],
		types: frontendTypes.map(type => type.code),
		catalogs: createdCatalogs
	})
}

main()
	.catch(error => {
		console.error('Seed failed:', error)
		process.exitCode = 1
	})
	.finally(async () => {
		await prisma.$disconnect()
	})
