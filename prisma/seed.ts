import { PrismaPg } from '@prisma/adapter-pg'
import { hash } from 'argon2'
import { createHash } from 'crypto'
import 'dotenv/config'
import path from 'path'

import { Prisma, PrismaClient, type ProductStatus } from './generated/client.js'

const databaseUrl = process.env.DATABASE_URI ?? process.env.DATABASE_URL

if (!databaseUrl) {
	throw new Error('DATABASE_URI or DATABASE_URL is not set')
}

const prisma = new PrismaClient({
	adapter: new PrismaPg({
		user: process.env.DATABASE_USER,
		password: process.env.DATABASE_PASSWORD,
		host: process.env.DATABASE_HOST,
		port: parseInt(process.env.DATABASE_PORT || '5432'),
		database: process.env.DATABASE_NAME
	})
})

const img = (seed: string, width = 1200, height = 800) =>
	`https://picsum.photos/seed/${encodeURIComponent(seed)}/${width}/${height}`

const square = (seed: string, size = 512) => img(seed, size, size)

const baseUrl = (catalog: { slug: string; domain?: string | null }) =>
	catalog.domain
		? `https://${catalog.domain}`
		: `https://${catalog.slug}.myctlg.ru`

const DEFAULT_MEDIA_MIME = 'image/jpeg'
const MEDIA_MIME_BY_EXT = new Map<string, string>([
	['.jpg', 'image/jpeg'],
	['.jpeg', 'image/jpeg'],
	['.png', 'image/png'],
	['.webp', 'image/webp'],
	['.avif', 'image/avif']
])
const MEDIA_EXT_BY_MIME: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/avif': 'avif'
}

const guessMediaMime = (url: string): string => {
	const cleaned = url.split('?')[0].split('#')[0]
	let ext = ''
	try {
		ext = path.extname(new URL(cleaned).pathname).toLowerCase()
	} catch {
		ext = path.extname(cleaned).toLowerCase()
	}
	return MEDIA_MIME_BY_EXT.get(ext) ?? DEFAULT_MEDIA_MIME
}

const buildMediaOriginalName = (url: string, mimeType: string): string => {
	const cleaned = url.split('?')[0].split('#')[0]
	let base = ''
	try {
		base = path.basename(new URL(cleaned).pathname)
	} catch {
		base = path.basename(cleaned)
	}
	base = base.replace(/\.[a-z0-9]+$/i, '')
	const safeBase = base.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '')
	const fallback = `media-${createHash('sha1')
		.update(url)
		.digest('hex')
		.slice(0, 8)}`
	const ext = MEDIA_EXT_BY_MIME[mimeType] ?? 'jpg'
	return `${safeBase || fallback}.${ext}`
}

const addMediaUrl = (
	map: Map<string, Set<string>>,
	catalogId: string,
	url?: string | null
) => {
	const trimmed = url?.trim()
	if (!trimmed) return
	const entry = map.get(catalogId) ?? new Set<string>()
	entry.add(trimmed)
	map.set(catalogId, entry)
}

const commonProductAttributes = [
	{
		key: 'brand',
		displayName: 'Бренд',
		dataType: 'ENUM',
		isRequired: true,
		isVariantAttribute: false,
		isFilterable: true,
		displayOrder: 88
	},
	{
		key: 'subtitle',
		displayName: 'Подзаголовок',
		dataType: 'STRING',
		isRequired: false,
		isVariantAttribute: false,
		isFilterable: false,
		displayOrder: 89
	},
	{
		key: 'about',
		displayName: 'О товаре',
		dataType: 'STRING',
		isRequired: false,
		isVariantAttribute: false,
		isFilterable: false,
		displayOrder: 90
	},
	{
		key: 'description',
		displayName: 'Описание',
		dataType: 'STRING',
		isRequired: false,
		isVariantAttribute: false,
		isFilterable: false,
		displayOrder: 91
	},
	{
		key: 'discount',
		displayName: 'Скидка',
		dataType: 'INTEGER',
		isRequired: false,
		isVariantAttribute: false,
		isFilterable: false,
		displayOrder: 92
	},
	{
		key: 'discountedPrice',
		displayName: 'Цена со скидкой',
		dataType: 'DECIMAL',
		isRequired: false,
		isVariantAttribute: false,
		isFilterable: false,
		displayOrder: 93
	},
	{
		key: 'discountStartAt',
		displayName: 'Скидка с',
		dataType: 'DATETIME',
		isRequired: false,
		isVariantAttribute: false,
		isFilterable: false,
		displayOrder: 94
	},
	{
		key: 'discountEndAt',
		displayName: 'Скидка до',
		dataType: 'DATETIME',
		isRequired: false,
		isVariantAttribute: false,
		isFilterable: false,
		displayOrder: 95
	}
] as const

const createCommonAttributes = async (typeId: string) => {
	const created = await Promise.all(
		commonProductAttributes.map(attribute =>
			prisma.attribute.create({
				data: {
					...attribute,
					typeId
				}
			})
		)
	)

	return Object.fromEntries(created.map(attribute => [attribute.key, attribute]))
}

const buildCommonProductAttributeValues = (
	products: { id: string; name: string; price: Prisma.Decimal | number }[],
	attributes: Record<string, { id: string }>,
	options: { discount: number; start: Date; end: Date }
) => {
	return products.flatMap(product => {
		const price = new Prisma.Decimal(product.price)
		const discountedPrice = price
			.mul(new Prisma.Decimal(100 - options.discount))
			.div(100)
			.toDecimalPlaces(2)

		return [
			{
				productId: product.id,
				attributeId: attributes.subtitle.id,
				valueString: `${product.name} — подзаголовок`
			},
			{
				productId: product.id,
				attributeId: attributes.about.id,
				valueString: `Кратко о ${product.name}.`
			},
			{
				productId: product.id,
				attributeId: attributes.description.id,
				valueString: `Описание товара ${product.name}.`
			},
			{
				productId: product.id,
				attributeId: attributes.discount.id,
				valueInteger: options.discount
			},
			{
				productId: product.id,
				attributeId: attributes.discountedPrice.id,
				valueDecimal: discountedPrice
			},
			{
				productId: product.id,
				attributeId: attributes.discountStartAt.id,
				valueDateTime: options.start
			},
			{
				productId: product.id,
				attributeId: attributes.discountEndAt.id,
				valueDateTime: options.end
			}
		]
	})
}

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

async function main() {
	await clearDatabase()

	const passwordHash = await hash('password')

	const regionMow = await prisma.regionality.create({
		data: { code: 'RU-MOW', name: 'Москва' }
	})
	const regionSpb = await prisma.regionality.create({
		data: { code: 'RU-SPE', name: 'Санкт-Петербург' }
	})
	const regionNyc = await prisma.regionality.create({
		data: { code: 'US-NYC', name: 'Нью-Йорк' }
	})
	const regionBer = await prisma.regionality.create({
		data: { code: 'DE-BE', name: 'Берлин' }
	})
	const regionDub = await prisma.regionality.create({
		data: { code: 'AE-DU', name: 'Дубай' }
	})
	const regionSfo = await prisma.regionality.create({
		data: { code: 'US-SFO', name: 'Сан-Франциско' }
	})

	const admin = await prisma.user.create({
		data: {
			name: 'Администратор',
			login: 'admin',
			password: passwordHash,
			role: 'ADMIN',
			isEmailConfirmed: true,
			regions: { connect: [{ id: regionMow.id }, { id: regionNyc.id }] }
		}
	})
	const catalogUserLumen = await prisma.user.create({
		data: {
			name: 'Владелец Lumen',
			login: 'lumen',
			password: passwordHash,
			role: 'CATALOG',
			isEmailConfirmed: true,
			regions: { connect: [{ id: regionMow.id }, { id: regionSpb.id }] }
		}
	})
	const catalogUserLumenOutlet = await prisma.user.create({
		data: {
			name: 'Владелец Lumen Outlet',
			login: 'lumen-outlet',
			password: passwordHash,
			role: 'CATALOG',
			isEmailConfirmed: true,
			regions: { connect: [{ id: regionSpb.id }] }
		}
	})
	const catalogUserGreen = await prisma.user.create({
		data: {
			name: 'Владелец Green Spoon',
			login: 'green-spoon',
			password: passwordHash,
			role: 'CATALOG',
			isEmailConfirmed: true,
			regions: { connect: [{ id: regionMow.id }] }
		}
	})
	const catalogUserUrban = await prisma.user.create({
		data: {
			name: 'Владелец Urban Cafe',
			login: 'urban-cafe',
			password: passwordHash,
			role: 'CATALOG',
			isEmailConfirmed: true,
			regions: { connect: [{ id: regionNyc.id }, { id: regionSfo.id }] }
		}
	})
	const catalogUserNova = await prisma.user.create({
		data: {
			name: 'Владелец Nova Tech',
			login: 'nova-tech',
			password: passwordHash,
			role: 'CATALOG',
			isEmailConfirmed: true,
			regions: { connect: [{ id: regionNyc.id }, { id: regionBer.id }] }
		}
	})
	const catalogUserGlow = await prisma.user.create({
		data: {
			name: 'Владелец Glow',
			login: 'glow',
			password: passwordHash,
			role: 'CATALOG',
			isEmailConfirmed: true,
			regions: { connect: [{ id: regionMow.id }, { id: regionBer.id }] }
		}
	})
	const shopper = await prisma.user.create({
		data: {
			name: 'Покупатель',
			login: 'user',
			password: passwordHash,
			role: 'USER',
			isEmailConfirmed: true,
			regions: { connect: [{ id: regionSpb.id }] }
		}
	})
	const shopper2 = await prisma.user.create({
		data: {
			name: 'Покупатель 2',
			login: 'user2',
			password: passwordHash,
			role: 'USER',
			isEmailConfirmed: false,
			regions: { connect: [{ id: regionDub.id }, { id: regionNyc.id }] }
		}
	})

	const activityRetail = await prisma.activity.create({
		data: { name: 'Розница' }
	})
	const activityFood = await prisma.activity.create({
		data: { name: 'Еда и напитки' }
	})
	const activityTech = await prisma.activity.create({
		data: { name: 'Электроника' }
	})
	const activityBeauty = await prisma.activity.create({
		data: { name: 'Красота и уход' }
	})

	const typeClothing = await prisma.type.create({
		data: {
			code: 'clothing',
			name: 'Одежда и аксессуары',
			activities: { connect: [{ id: activityRetail.id }] }
		}
	})
	const typeRestaurant = await prisma.type.create({
		data: {
			code: 'restaurant',
			name: 'Рестораны и кафе',
			activities: { connect: [{ id: activityFood.id }] }
		}
	})
	const typeElectronics = await prisma.type.create({
		data: {
			code: 'electronics',
			name: 'Электроника и гаджеты',
			activities: { connect: [{ id: activityTech.id }] }
		}
	})
	const typeBeauty = await prisma.type.create({
		data: {
			code: 'beauty',
			name: 'Красота и уход',
			activities: {
				connect: [{ id: activityBeauty.id }, { id: activityRetail.id }]
			}
		}
	})

	const [
		commonClothingAttributes,
		commonRestaurantAttributes,
		commonElectronicsAttributes,
		commonBeautyAttributes
	] = await Promise.all([
		createCommonAttributes(typeClothing.id),
		createCommonAttributes(typeRestaurant.id),
		createCommonAttributes(typeElectronics.id),
		createCommonAttributes(typeBeauty.id)
	])

	const attrBrand = commonClothingAttributes.brand
	const attrRestaurantBrand = commonRestaurantAttributes.brand
	const attrTechBrand = commonElectronicsAttributes.brand
	const attrBeautyBrand = commonBeautyAttributes.brand

	const attrSize = await prisma.attribute.create({
		data: {
			typeId: typeClothing.id,
			key: 'size',
			displayName: 'Размер',
			dataType: 'ENUM',
			isRequired: true,
			isVariantAttribute: true,
			isFilterable: true,
			displayOrder: 2
		}
	})
	const attrColor = await prisma.attribute.create({
		data: {
			typeId: typeClothing.id,
			key: 'color',
			displayName: 'Цвет',
			dataType: 'ENUM',
			isRequired: true,
			isVariantAttribute: true,
			isFilterable: true,
			displayOrder: 3
		}
	})
	const attrMaterial = await prisma.attribute.create({
		data: {
			typeId: typeClothing.id,
			key: 'material',
			displayName: 'Материал',
			dataType: 'STRING',
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 4
		}
	})
	const attrFit = await prisma.attribute.create({
		data: {
			typeId: typeClothing.id,
			key: 'fit',
			displayName: 'Посадка',
			dataType: 'ENUM',
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 5
		}
	})
	const attrGender = await prisma.attribute.create({
		data: {
			typeId: typeClothing.id,
			key: 'gender',
			displayName: 'Пол',
			dataType: 'ENUM',
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 6
		}
	})
	const attrSeason = await prisma.attribute.create({
		data: {
			typeId: typeClothing.id,
			key: 'season',
			displayName: 'Сезон',
			dataType: 'ENUM',
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 7
		}
	})
	const attrShoeSize = await prisma.attribute.create({
		data: {
			typeId: typeClothing.id,
			key: 'shoe_size',
			displayName: 'Размерный ряд обуви',
			dataType: 'ENUM',
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 8
		}
	})

	const attrIngredients = await prisma.attribute.create({
		data: {
			typeId: typeRestaurant.id,
			key: 'ingredients',
			displayName: 'Состав',
			dataType: 'STRING',
			isRequired: true,
			isVariantAttribute: false,
			isFilterable: false,
			displayOrder: 1
		}
	})
	const attrCalories = await prisma.attribute.create({
		data: {
			typeId: typeRestaurant.id,
			key: 'calories',
			displayName: 'Калории',
			dataType: 'INTEGER',
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 2
		}
	})
	const attrIsVegan = await prisma.attribute.create({
		data: {
			typeId: typeRestaurant.id,
			key: 'is_vegan',
			displayName: 'Веганское',
			dataType: 'BOOLEAN',
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 3
		}
	})
	const attrWeight = await prisma.attribute.create({
		data: {
			typeId: typeRestaurant.id,
			key: 'weight',
			displayName: 'Вес',
			dataType: 'DECIMAL',
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 4
		}
	})
	const attrSpicy = await prisma.attribute.create({
		data: {
			typeId: typeRestaurant.id,
			key: 'spicy_level',
			displayName: 'Острота',
			dataType: 'ENUM',
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 5
		}
	})
	const attrAllergens = await prisma.attribute.create({
		data: {
			typeId: typeRestaurant.id,
			key: 'allergens',
			displayName: 'Аллергены',
			dataType: 'STRING',
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 6
		}
	})
	const attrCookingTime = await prisma.attribute.create({
		data: {
			typeId: typeRestaurant.id,
			key: 'cooking_time',
			displayName: 'Время приготовления (мин)',
			dataType: 'INTEGER',
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 7
		}
	})

	const attrTechColor = await prisma.attribute.create({
		data: {
			typeId: typeElectronics.id,
			key: 'color',
			displayName: 'Цвет',
			dataType: 'ENUM',
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 2
		}
	})
	const attrScreenSize = await prisma.attribute.create({
		data: {
			typeId: typeElectronics.id,
			key: 'screen_size',
			displayName: 'Диагональ экрана',
			dataType: 'DECIMAL',
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 3
		}
	})
	const attrMemory = await prisma.attribute.create({
		data: {
			typeId: typeElectronics.id,
			key: 'memory',
			displayName: 'ОЗУ',
			dataType: 'INTEGER',
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 4
		}
	})
	const attrStorage = await prisma.attribute.create({
		data: {
			typeId: typeElectronics.id,
			key: 'storage',
			displayName: 'Память',
			dataType: 'INTEGER',
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 5
		}
	})
	const attrBattery = await prisma.attribute.create({
		data: {
			typeId: typeElectronics.id,
			key: 'battery',
			displayName: 'Батарея (мА·ч)',
			dataType: 'INTEGER',
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 6
		}
	})
	const attrRefurb = await prisma.attribute.create({
		data: {
			typeId: typeElectronics.id,
			key: 'is_refurbished',
			displayName: 'Восстановленный',
			dataType: 'BOOLEAN',
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 7
		}
	})
	const attrWarranty = await prisma.attribute.create({
		data: {
			typeId: typeElectronics.id,
			key: 'warranty_months',
			displayName: 'Гарантия (мес)',
			dataType: 'INTEGER',
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 8
		}
	})

	const attrBeautyVolume = await prisma.attribute.create({
		data: {
			typeId: typeBeauty.id,
			key: 'volume',
			displayName: 'Объем',
			dataType: 'DECIMAL',
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 2
		}
	})
	const attrBeautySkinType = await prisma.attribute.create({
		data: {
			typeId: typeBeauty.id,
			key: 'skin_type',
			displayName: 'Тип кожи',
			dataType: 'ENUM',
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 3
		}
	})
	const attrBeautyOrganic = await prisma.attribute.create({
		data: {
			typeId: typeBeauty.id,
			key: 'is_organic',
			displayName: 'Органический',
			dataType: 'BOOLEAN',
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 4
		}
	})
	const attrBeautyColor = await prisma.attribute.create({
		data: {
			typeId: typeBeauty.id,
			key: 'color',
			displayName: 'Оттенок',
			dataType: 'ENUM',
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 5
		}
	})

	const brandLumen = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrBrand.id,
			value: 'lumen',
			displayName: 'Lumen',
			displayOrder: 1
		}
	})
	const brandNova = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrBrand.id,
			value: 'nova',
			displayName: 'Nova',
			displayOrder: 2
		}
	})
	const brandOrbit = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrBrand.id,
			value: 'orbit',
			displayName: 'Orbit',
			displayOrder: 3
		}
	})
	const brandGreen = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrRestaurantBrand.id,
			value: 'green',
			displayName: 'Грин Спун',
			displayOrder: 1
		}
	})
	const brandUrban = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrRestaurantBrand.id,
			value: 'urban',
			displayName: 'Урбан Кафе',
			displayOrder: 2
		}
	})
	const sizeXxs = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrSize.id,
			value: 'xxs',
			displayName: 'XXS',
			displayOrder: 1
		}
	})
	const sizeXs = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrSize.id,
			value: 'xs',
			displayName: 'XS',
			displayOrder: 2
		}
	})
	const sizeS = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrSize.id,
			value: 's',
			displayName: 'S',
			displayOrder: 3
		}
	})
	const sizeM = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrSize.id,
			value: 'm',
			displayName: 'M',
			displayOrder: 4
		}
	})
	const sizeL = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrSize.id,
			value: 'l',
			displayName: 'L',
			displayOrder: 5
		}
	})
	const sizeXl = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrSize.id,
			value: 'xl',
			displayName: 'XL',
			displayOrder: 6
		}
	})
	const sizeXxl = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrSize.id,
			value: 'xxl',
			displayName: 'XXL',
			displayOrder: 7
		}
	})
	for (let size = 30; size <= 48; size += 1) {
		await prisma.attributeEnumValue.create({
			data: {
				attributeId: attrShoeSize.id,
				value: String(size),
				displayName: String(size),
				displayOrder: size - 29
			}
		})
	}
	const colorWhite = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrColor.id,
			value: 'white',
			displayName: 'Белый',
			displayOrder: 1
		}
	})
	const colorBlack = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrColor.id,
			value: 'black',
			displayName: 'Черный',
			displayOrder: 2
		}
	})
	const colorBlue = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrColor.id,
			value: 'blue',
			displayName: 'Синий',
			displayOrder: 3
		}
	})
	const colorRed = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrColor.id,
			value: 'red',
			displayName: 'Красный',
			displayOrder: 4
		}
	})

	const fitRegular = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrFit.id,
			value: 'regular',
			displayName: 'Стандарт',
			displayOrder: 1
		}
	})
	const fitSlim = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrFit.id,
			value: 'slim',
			displayName: 'Слим',
			displayOrder: 2
		}
	})
	const fitOversize = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrFit.id,
			value: 'oversize',
			displayName: 'Оверсайз',
			displayOrder: 3
		}
	})

	const genderMen = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrGender.id,
			value: 'men',
			displayName: 'Мужской',
			displayOrder: 1
		}
	})
	const genderWomen = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrGender.id,
			value: 'women',
			displayName: 'Женский',
			displayOrder: 2
		}
	})
	const genderUnisex = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrGender.id,
			value: 'unisex',
			displayName: 'Унисекс',
			displayOrder: 3
		}
	})

	const seasonSummer = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrSeason.id,
			value: 'summer',
			displayName: 'Лето',
			displayOrder: 1
		}
	})
	const seasonWinter = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrSeason.id,
			value: 'winter',
			displayName: 'Зима',
			displayOrder: 2
		}
	})
	const seasonAll = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrSeason.id,
			value: 'all-season',
			displayName: 'Всесезон',
			displayOrder: 3
		}
	})

	const spicyMild = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrSpicy.id,
			value: 'mild',
			displayName: 'Слабая',
			displayOrder: 1
		}
	})
	const spicyMedium = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrSpicy.id,
			value: 'medium',
			displayName: 'Средняя',
			displayOrder: 2
		}
	})
	const spicyHot = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrSpicy.id,
			value: 'hot',
			displayName: 'Острая',
			displayOrder: 3
		}
	})

	const techBrandNova = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrTechBrand.id,
			value: 'nova',
			displayName: 'Nova',
			displayOrder: 1
		}
	})
	const techBrandOrbit = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrTechBrand.id,
			value: 'orbit',
			displayName: 'Orbit',
			displayOrder: 2
		}
	})
	const techBrandPhoton = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrTechBrand.id,
			value: 'photon',
			displayName: 'Photon',
			displayOrder: 3
		}
	})

	const techColorBlack = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrTechColor.id,
			value: 'black',
			displayName: 'Черный',
			displayOrder: 1
		}
	})
	const techColorSilver = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrTechColor.id,
			value: 'silver',
			displayName: 'Серебристый',
			displayOrder: 2
		}
	})
	const techColorBlue = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrTechColor.id,
			value: 'blue',
			displayName: 'Синий',
			displayOrder: 3
		}
	})

	const beautyBrandGlow = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrBeautyBrand.id,
			value: 'glow',
			displayName: 'Glow',
			displayOrder: 1
		}
	})
	const beautyBrandAura = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrBeautyBrand.id,
			value: 'aura',
			displayName: 'Aura',
			displayOrder: 2
		}
	})

	const skinDry = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrBeautySkinType.id,
			value: 'dry',
			displayName: 'Сухая',
			displayOrder: 1
		}
	})
	const skinOily = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrBeautySkinType.id,
			value: 'oily',
			displayName: 'Жирная',
			displayOrder: 2
		}
	})
	const skinNormal = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrBeautySkinType.id,
			value: 'normal',
			displayName: 'Нормальная',
			displayOrder: 3
		}
	})

	const beautyColorNude = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrBeautyColor.id,
			value: 'nude',
			displayName: 'Нюд',
			displayOrder: 1
		}
	})
	const beautyColorRed = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrBeautyColor.id,
			value: 'red',
			displayName: 'Красный',
			displayOrder: 2
		}
	})
	const beautyColorRose = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrBeautyColor.id,
			value: 'rose',
			displayName: 'Розовый',
			displayOrder: 3
		}
	})

	const catalogLumen = await prisma.catalog.create({
		data: {
			slug: 'lumen',
			domain: 'lumen.demo',
			name: 'Lumen Одежда',
			typeId: typeClothing.id,
			userId: catalogUserLumen.id,
			activity: { connect: [{ id: activityRetail.id }] },
			region: { connect: [{ id: regionMow.id }, { id: regionSpb.id }] }
		}
	})
	const catalogLumenOutlet = await prisma.catalog.create({
		data: {
			slug: 'lumen-outlet',
			name: 'Lumen Аутлет',
			typeId: typeClothing.id,
			parentId: catalogLumen.id,
			userId: catalogUserLumenOutlet.id,
			activity: { connect: [{ id: activityRetail.id }] },
			region: { connect: [{ id: regionSpb.id }] }
		}
	})
	const catalogGreen = await prisma.catalog.create({
		data: {
			slug: 'green-spoon',
			domain: 'greenspoon.demo',
			name: 'Грин Спун',
			typeId: typeRestaurant.id,
			userId: catalogUserGreen.id,
			activity: { connect: [{ id: activityFood.id }] },
			region: { connect: [{ id: regionMow.id }] }
		}
	})
	const catalogUrban = await prisma.catalog.create({
		data: {
			slug: 'urban-cafe',
			domain: 'urbancafe.demo',
			name: 'Урбан Кафе',
			typeId: typeRestaurant.id,
			userId: catalogUserUrban.id,
			activity: { connect: [{ id: activityFood.id }] },
			region: { connect: [{ id: regionNyc.id }, { id: regionSfo.id }] }
		}
	})
	const catalogNova = await prisma.catalog.create({
		data: {
			slug: 'nova-tech',
			domain: 'novatech.demo',
			name: 'Нова Тех',
			typeId: typeElectronics.id,
			userId: catalogUserNova.id,
			activity: { connect: [{ id: activityTech.id }] },
			region: { connect: [{ id: regionNyc.id }, { id: regionBer.id }] }
		}
	})
	const catalogGlow = await prisma.catalog.create({
		data: {
			slug: 'glow',
			domain: 'glow.demo',
			name: 'Глоу Бьюти',
			typeId: typeBeauty.id,
			userId: catalogUserGlow.id,
			activity: {
				connect: [{ id: activityBeauty.id }, { id: activityRetail.id }]
			},
			region: { connect: [{ id: regionMow.id }, { id: regionBer.id }] }
		}
	})

	await prisma.catalogConfig.createMany({
		data: [
			{
				catalogId: catalogLumen.id,
				about: 'Минималистичная базовая одежда на каждый день.',
				description: 'Сезонные коллекции и основные позиции.',
				currency: 'RUB',
				logoUrl: square('lumen-logo'),
				bgUrl: img('lumen-hero', 1600, 900),
				status: 'OPERATIONAL',
				note: 'Данные сидера'
			},
			{
				catalogId: catalogLumenOutlet.id,
				about: 'Аутлет с товарами прошлых сезонов.',
				description: 'Ограниченные остатки и специальные цены.',
				currency: 'RUB',
				logoUrl: square('lumen-outlet-logo'),
				bgUrl: img('lumen-outlet-hero', 1600, 900),
				status: 'PROPOSAL',
				note: 'Данные сидера'
			},
			{
				catalogId: catalogGreen.id,
				about: 'Свежая еда каждый день.',
				description: 'Бургеры, салаты и гарниры.',
				currency: 'RUB',
				logoUrl: square('greenspoon-logo'),
				bgUrl: img('greenspoon-hero', 1600, 900),
				status: 'OPERATIONAL',
				note: 'Данные сидера'
			},
			{
				catalogId: catalogUrban.id,
				about: 'Кофе, выпечка и завтраки.',
				description: 'Городское кафе с сезонным меню.',
				currency: 'USD',
				logoUrl: square('urbancafe-logo'),
				bgUrl: img('urbancafe-hero', 1600, 900),
				status: 'OPERATIONAL',
				note: 'Данные сидера'
			},
			{
				catalogId: catalogNova.id,
				about: 'Устройства и аксессуары для повседневной жизни.',
				description: 'Смартфоны, ноутбуки и аудио.',
				currency: 'USD',
				logoUrl: square('novatech-logo'),
				bgUrl: img('novatech-hero', 1600, 900),
				status: 'IMPLEMENTATION',
				note: 'Данные сидера'
			},
			{
				catalogId: catalogGlow.id,
				about: 'Уход за кожей и ежедневные ритуалы.',
				description: 'Чистые формулы и минималистичные процедуры.',
				currency: 'EUR',
				logoUrl: square('glow-logo'),
				bgUrl: img('glow-hero', 1600, 900),
				status: 'PROPOSAL',
				note: 'Данные сидера'
			}
		]
	})

	await prisma.catalogSettings.createMany({
		data: [
			{
				catalogId: catalogLumen.id,
				isActive: true
			},
			{
				catalogId: catalogLumenOutlet.id,
				isActive: true
			},
			{
				catalogId: catalogGreen.id,
				isActive: true
			},
			{
				catalogId: catalogUrban.id,
				isActive: true
			},
			{
				catalogId: catalogNova.id,
				isActive: true
			},
			{
				catalogId: catalogGlow.id,
				isActive: true
			}
		]
	})

	await prisma.catalogContact.createMany({
		data: [
			{
				catalogId: catalogLumen.id,
				type: 'PHONE',
				position: 1,
				value: '+1 555 010 0001'
			},
			{
				catalogId: catalogLumen.id,
				type: 'EMAIL',
				position: 2,
				value: 'hello@lumen.demo'
			},
			{
				catalogId: catalogLumen.id,
				type: 'MAP',
				position: 3,
				value: 'https://maps.google.com/?q=Lumen+Store'
			},
			{
				catalogId: catalogLumen.id,
				type: 'WHATSAPP',
				position: 4,
				value: '+1 555 010 0001'
			},
			{
				catalogId: catalogLumenOutlet.id,
				type: 'PHONE',
				position: 1,
				value: '+1 555 010 0009'
			},
			{
				catalogId: catalogLumenOutlet.id,
				type: 'EMAIL',
				position: 2,
				value: 'hello@lumen-outlet.demo'
			},
			{
				catalogId: catalogLumenOutlet.id,
				type: 'MAP',
				position: 3,
				value: 'https://maps.google.com/?q=Lumen+Outlet'
			},
			{
				catalogId: catalogGreen.id,
				type: 'PHONE',
				position: 1,
				value: '+1 555 020 0002'
			},
			{
				catalogId: catalogGreen.id,
				type: 'EMAIL',
				position: 2,
				value: 'hello@greenspoon.demo'
			},
			{
				catalogId: catalogGreen.id,
				type: 'MAP',
				position: 3,
				value: 'https://maps.google.com/?q=Green+Spoon'
			},
			{
				catalogId: catalogUrban.id,
				type: 'PHONE',
				position: 1,
				value: '+1 555 030 0001'
			},
			{
				catalogId: catalogUrban.id,
				type: 'EMAIL',
				position: 2,
				value: 'hello@urbancafe.demo'
			},
			{
				catalogId: catalogUrban.id,
				type: 'TELEGRAM',
				position: 3,
				value: '@urbancafe'
			},
			{
				catalogId: catalogNova.id,
				type: 'PHONE',
				position: 1,
				value: '+1 555 040 0001'
			},
			{
				catalogId: catalogNova.id,
				type: 'EMAIL',
				position: 2,
				value: 'support@novatech.demo'
			},
			{
				catalogId: catalogNova.id,
				type: 'MAP',
				position: 3,
				value: 'https://maps.google.com/?q=Nova+Tech'
			},
			{
				catalogId: catalogGlow.id,
				type: 'PHONE',
				position: 1,
				value: '+1 555 050 0001'
			},
			{
				catalogId: catalogGlow.id,
				type: 'EMAIL',
				position: 2,
				value: 'hello@glow.demo'
			},
			{
				catalogId: catalogGlow.id,
				type: 'WHATSAPP',
				position: 3,
				value: '+1 555 050 0001'
			},
			{
				catalogId: catalogGlow.id,
				type: 'MAP',
				position: 4,
				value: 'https://maps.google.com/?q=Glow+Beauty'
			}
		]
	})

	await prisma.metrics.createMany({
		data: [
			{
				catalogId: catalogLumen.id,
				provider: 'YANDEX',
				counterId: '104676804'
			},
			{
				catalogId: catalogGreen.id,
				provider: 'YANDEX',
				counterId: '204676805'
			},
			{
				catalogId: catalogLumenOutlet.id,
				provider: 'YANDEX',
				counterId: '104676805'
			},
			{
				catalogId: catalogUrban.id,
				provider: 'YANDEX',
				counterId: '204676806'
			},
			{
				catalogId: catalogNova.id,
				provider: 'YANDEX',
				counterId: '304676806'
			},
			{
				catalogId: catalogGlow.id,
				provider: 'YANDEX',
				counterId: '404676807'
			}
		]
	})

	await prisma.payment.createMany({
		data: [
			{ catalogId: catalogLumen.id },
			{ catalogId: catalogLumenOutlet.id },
			{ catalogId: catalogGreen.id },
			{ catalogId: catalogUrban.id },
			{ catalogId: catalogNova.id },
			{ catalogId: catalogGlow.id }
		]
	})

	await prisma.integration.create({
		data: {
			name: 'yandex-metrika',
			metadata: {
				enabled: true,
				counterId: '104676804',
				note: 'Seed integration'
			}
		}
	})
	await prisma.integration.createMany({
		data: [
			{
				name: 'telegram-bot',
				metadata: {
					enabled: true,
					channel: '@catalog_alerts',
					note: 'Seed integration'
				}
			},
			{
				name: 'sms-gateway',
				metadata: {
					enabled: true,
					provider: 'twilio',
					note: 'Seed integration'
				}
			},
			{
				name: 'crm-sync',
				metadata: {
					enabled: true,
					provider: 'hubspot',
					note: 'Seed integration'
				}
			}
		]
	})

	await prisma.s3.createMany({
		data: [
			{
				name: 'seed-storage',
				accessKey: 'SEEDACCESSKEY',
				secretAccessKey: 'SEEDSECRETKEY',
				region: 'eu-central-1'
			},
			{
				name: 'seed-archive',
				accessKey: 'SEEDARCHIVEKEY',
				secretAccessKey: 'SEEDARCHIVESECRET',
				region: 'us-east-1'
			}
		]
	})

	const mediaHero = await prisma.media.create({
		data: {
			catalogId: catalogLumen.id,
			originalName: 'hero.jpg',
			mimeType: 'image/jpeg',
			size: 245000,
			width: 1600,
			height: 900,
			storage: 'url',
			key: img('media-hero', 1600, 900),
			checksum: 'seed-hero',
			status: 'READY'
		}
	})
	const mediaBanner = await prisma.media.create({
		data: {
			catalogId: catalogLumen.id,
			originalName: 'banner.jpg',
			mimeType: 'image/jpeg',
			size: 180000,
			width: 1200,
			height: 800,
			storage: 'url',
			key: img('media-banner', 1200, 800),
			checksum: 'seed-banner',
			status: 'READY'
		}
	})
	const mediaPhone = await prisma.media.create({
		data: {
			catalogId: catalogLumen.id,
			originalName: 'phone.jpg',
			mimeType: 'image/jpeg',
			size: 210000,
			width: 1400,
			height: 1000,
			storage: 'url',
			key: img('media-phone', 1400, 1000),
			checksum: 'seed-phone',
			status: 'READY'
		}
	})
	const mediaSerum = await prisma.media.create({
		data: {
			catalogId: catalogLumen.id,
			originalName: 'serum.jpg',
			mimeType: 'image/jpeg',
			size: 160000,
			width: 1200,
			height: 900,
			storage: 'url',
			key: img('media-serum', 1200, 900),
			checksum: 'seed-serum',
			status: 'READY'
		}
	})

	await prisma.mediaVariant.createMany({
		data: [
			{
				mediaId: mediaHero.id,
				kind: 'square_256',
				mimeType: 'image/jpeg',
				size: 18000,
				width: 256,
				height: 256,
				storage: 'url',
				key: square('media-hero-256', 256)
			},
			{
				mediaId: mediaHero.id,
				kind: 'medium',
				mimeType: 'image/jpeg',
				size: 120000,
				width: 800,
				height: 600,
				storage: 'url',
				key: img('media-hero-medium', 800, 600)
			},
			{
				mediaId: mediaBanner.id,
				kind: 'square_256',
				mimeType: 'image/jpeg',
				size: 16000,
				width: 256,
				height: 256,
				storage: 'url',
				key: square('media-banner-256', 256)
			},
			{
				mediaId: mediaBanner.id,
				kind: 'medium',
				mimeType: 'image/jpeg',
				size: 100000,
				width: 800,
				height: 533,
				storage: 'url',
				key: img('media-banner-medium', 800, 533)
			},
			{
				mediaId: mediaPhone.id,
				kind: 'square_256',
				mimeType: 'image/jpeg',
				size: 22000,
				width: 256,
				height: 256,
				storage: 'url',
				key: square('media-phone-256', 256)
			},
			{
				mediaId: mediaPhone.id,
				kind: 'medium',
				mimeType: 'image/jpeg',
				size: 130000,
				width: 900,
				height: 700,
				storage: 'url',
				key: img('media-phone-medium', 900, 700)
			},
			{
				mediaId: mediaSerum.id,
				kind: 'square_256',
				mimeType: 'image/jpeg',
				size: 18000,
				width: 256,
				height: 256,
				storage: 'url',
				key: square('media-serum-256', 256)
			},
			{
				mediaId: mediaSerum.id,
				kind: 'medium',
				mimeType: 'image/jpeg',
				size: 90000,
				width: 800,
				height: 600,
				storage: 'url',
				key: img('media-serum-medium', 800, 600)
			}
		]
	})

	const categoryMen = await prisma.category.create({
		data: {
			catalogId: catalogLumen.id,
			name: 'Мужское',
			position: 1,
			imageUrl: img('category-men', 800, 800),
			descriptor: 'Базовый мужской гардероб'
		}
	})
	const categoryWomen = await prisma.category.create({
		data: {
			catalogId: catalogLumen.id,
			name: 'Женское',
			position: 2,
			imageUrl: img('category-women', 800, 800),
			descriptor: 'Базовый женский гардероб'
		}
	})
	const categoryAccessories = await prisma.category.create({
		data: {
			catalogId: catalogLumen.id,
			name: 'Аксессуары',
			position: 3,
			imageUrl: img('category-accessories', 800, 800),
			descriptor: 'Сумки и аксессуары',
			discount: 10
		}
	})
	const categoryTshirts = await prisma.category.create({
		data: {
			catalogId: catalogLumen.id,
			name: 'Футболки',
			position: 1,
			parentId: categoryMen.id,
			imageUrl: img('category-tshirts', 800, 800),
			descriptor: 'Футболки на каждый день'
		}
	})
	const categoryJeans = await prisma.category.create({
		data: {
			catalogId: catalogLumen.id,
			name: 'Джинсы',
			position: 2,
			parentId: categoryMen.id,
			imageUrl: img('category-jeans', 800, 800),
			descriptor: 'Слим и стандартная посадка'
		}
	})
	const categoryHoodies = await prisma.category.create({
		data: {
			catalogId: catalogLumen.id,
			name: 'Худи',
			position: 3,
			parentId: categoryMen.id,
			imageUrl: img('category-hoodies', 800, 800),
			descriptor: 'Теплые слои'
		}
	})
	const categoryDresses = await prisma.category.create({
		data: {
			catalogId: catalogLumen.id,
			name: 'Платья',
			position: 1,
			parentId: categoryWomen.id,
			imageUrl: img('category-dresses', 800, 800),
			descriptor: 'Сезонные платья'
		}
	})
	const categoryTops = await prisma.category.create({
		data: {
			catalogId: catalogLumen.id,
			name: 'Топы',
			position: 2,
			parentId: categoryWomen.id,
			imageUrl: img('category-tops', 800, 800),
			descriptor: 'Топы на каждый день'
		}
	})
	const categoryOutletSale = await prisma.category.create({
		data: {
			catalogId: catalogLumenOutlet.id,
			name: 'Распродажа',
			position: 1,
			imageUrl: img('category-outlet-sale', 800, 800),
			descriptor: 'Выгодные предложения',
			discount: 30
		}
	})
	const categoryOutletLastChance = await prisma.category.create({
		data: {
			catalogId: catalogLumenOutlet.id,
			name: 'Последний шанс',
			position: 2,
			imageUrl: img('category-outlet-last', 800, 800),
			descriptor: 'Последние остатки',
			discount: 40
		}
	})
	const categoryBurgers = await prisma.category.create({
		data: {
			catalogId: catalogGreen.id,
			name: 'Бургеры',
			position: 1,
			imageUrl: img('category-burgers', 800, 800),
			descriptor: 'Классика и фирменные'
		}
	})
	const categorySalads = await prisma.category.create({
		data: {
			catalogId: catalogGreen.id,
			name: 'Салаты',
			position: 2,
			imageUrl: img('category-salads', 800, 800),
			descriptor: 'Свежие и легкие'
		}
	})
	const categoryDrinks = await prisma.category.create({
		data: {
			catalogId: catalogGreen.id,
			name: 'Напитки',
			position: 3,
			imageUrl: img('category-drinks', 800, 800),
			descriptor: 'Свежие напитки'
		}
	})
	const categoryDesserts = await prisma.category.create({
		data: {
			catalogId: catalogGreen.id,
			name: 'Десерты',
			position: 4,
			imageUrl: img('category-desserts', 800, 800),
			descriptor: 'Сладости',
			discount: 5
		}
	})
	const categoryCoffee = await prisma.category.create({
		data: {
			catalogId: catalogUrban.id,
			name: 'Кофе',
			position: 1,
			imageUrl: img('category-coffee', 800, 800),
			descriptor: 'Кофейная классика'
		}
	})
	const categoryPastries = await prisma.category.create({
		data: {
			catalogId: catalogUrban.id,
			name: 'Выпечка',
			position: 2,
			imageUrl: img('category-pastries', 800, 800),
			descriptor: 'Выпечка каждый день'
		}
	})
	const categoryPhones = await prisma.category.create({
		data: {
			catalogId: catalogNova.id,
			name: 'Телефоны',
			position: 1,
			imageUrl: img('category-phones', 800, 800),
			descriptor: 'Смартфоны'
		}
	})
	const categoryLaptops = await prisma.category.create({
		data: {
			catalogId: catalogNova.id,
			name: 'Ноутбуки',
			position: 2,
			imageUrl: img('category-laptops', 800, 800),
			descriptor: 'Ноутбуки и ультрабуки'
		}
	})
	const categoryGadgets = await prisma.category.create({
		data: {
			catalogId: catalogNova.id,
			name: 'Гаджеты',
			position: 3,
			imageUrl: img('category-gadgets', 800, 800),
			descriptor: 'Аудио и аксессуары'
		}
	})
	const categorySkincare = await prisma.category.create({
		data: {
			catalogId: catalogGlow.id,
			name: 'Уход за кожей',
			position: 1,
			imageUrl: img('category-skincare', 800, 800),
			descriptor: 'Базовый уход'
		}
	})
	const categoryMakeup = await prisma.category.create({
		data: {
			catalogId: catalogGlow.id,
			name: 'Макияж',
			position: 2,
			imageUrl: img('category-makeup', 800, 800),
			descriptor: 'Подборка макияжа'
		}
	})

	const tshirtPrice = 1999
	const jeansPrice = 3999
	const hoodiePrice = 4599
	const shirtPrice = 2699
	const dressPrice = 5999
	const outletTshirtPrice = 1499
	const outletJacketPrice = 4999
	const outletJeansPrice = 2999
	const burgerPrice = 349
	const saladPrice = 299
	const wrapPrice = 379
	const juicePrice = 249
	const cakePrice = 329
	const espressoPrice = 199
	const cappuccinoPrice = 249
	const croissantPrice = 229
	const phonePrice = 79999
	const laptopPrice = 129999
	const earbudsPrice = 9999
	const serumPrice = 3499
	const lipstickPrice = 1299
	const cleanserPrice = 1899

	const productTshirt = await prisma.product.create({
		data: {
			catalogId: catalogLumen.id,
			sku: 'LUM-TSHIRT-001',
			name: 'Базовая футболка',
			slug: 'basic-tshirt',
			price: tshirtPrice,
			imagesUrls: [
				img('product-tshirt-1'),
				img('product-tshirt-2'),
				img('product-tshirt-3')
			],
			isPopular: true,
			status: 'ACTIVE',
			position: 1
		}
	})
	const productJeans = await prisma.product.create({
		data: {
			catalogId: catalogLumen.id,
			sku: 'LUM-JEANS-001',
			name: 'Джинсы слим',
			slug: 'slim-jeans',
			price: jeansPrice,
			imagesUrls: [img('product-jeans-1'), img('product-jeans-2')],
			isPopular: false,
			status: 'ACTIVE',
			position: 2
		}
	})
	const productHoodie = await prisma.product.create({
		data: {
			catalogId: catalogLumen.id,
			sku: 'LUM-HOODIE-001',
			name: 'Классическое худи',
			slug: 'classic-hoodie',
			price: hoodiePrice,
			imagesUrls: [img('product-hoodie-1'), img('product-hoodie-2')],
			isPopular: true,
			status: 'ACTIVE',
			position: 3
		}
	})
	const productLinenShirt = await prisma.product.create({
		data: {
			catalogId: catalogLumen.id,
			sku: 'LUM-SHIRT-001',
			name: 'Льняная рубашка',
			slug: 'linen-shirt',
			price: shirtPrice,
			imagesUrls: [img('product-shirt-1'), img('product-shirt-2')],
			isPopular: false,
			status: 'ACTIVE',
			position: 4
		}
	})
	const productDress = await prisma.product.create({
		data: {
			catalogId: catalogLumen.id,
			sku: 'LUM-DRESS-001',
			name: 'Летнее платье',
			slug: 'summer-dress',
			price: dressPrice,
			imagesUrls: [img('product-dress-1'), img('product-dress-2')],
			isPopular: true,
			status: 'ACTIVE',
			position: 5
		}
	})
	const productSilkTop = await prisma.product.create({
		data: {
			catalogId: catalogLumen.id,
			sku: 'LUM-TOP-001',
			name: 'Шелковый топ',
			slug: 'silk-top',
			price: shirtPrice,
			imagesUrls: [img('product-top-1'), img('product-top-2')],
			isPopular: false,
			status: 'ACTIVE',
			position: 6
		}
	})
	const productTote = await prisma.product.create({
		data: {
			catalogId: catalogLumen.id,
			sku: 'LUM-BAG-001',
			name: 'Холщовая сумка',
			slug: 'canvas-tote',
			price: tshirtPrice,
			imagesUrls: [img('product-tote-1')],
			isPopular: false,
			status: 'ACTIVE',
			position: 7
		}
	})

	type LumenExtraProductDefinition = {
		sku: string
		name: string
		slug: string
		price: number
		imagesUrls: string[]
		isPopular: boolean
		status: ProductStatus
		position: number
		categories: string[]
		attributes: {
			brand: { id: string }
			material: string
			fit: { id: string }
			gender: { id: string }
			season: { id: string }
		}
		variants?: {
			sku: string
			size: { id: string; value: string }
			color: { id: string; value: string }
			stock: number
			price: number
		}[]
	}

	const lumenExtraProductDefinitions: ReadonlyArray<LumenExtraProductDefinition> =
		[
			{
				sku: 'LUM-TSHIRT-002',
				name: 'Плотная футболка',
				slug: 'heavyweight-tee',
				price: 2299,
				imagesUrls: [
					img('product-heavyweight-tee-1'),
					img('product-heavyweight-tee-2')
				],
				isPopular: false,
				status: 'ACTIVE',
				position: 8,
				categories: [categoryTshirts.id, categoryMen.id],
				attributes: {
					brand: brandLumen,
					material: 'Плотный хлопок',
					fit: fitRegular,
					gender: genderMen,
					season: seasonSummer
				},
				variants: [
					{
						sku: 'LUM-TSHIRT-002-S-WHT',
						size: { id: sizeS.id, value: 's' },
						color: { id: colorWhite.id, value: 'white' },
						stock: 12,
						price: 0
					},
					{
						sku: 'LUM-TSHIRT-002-M-BLK',
						size: { id: sizeM.id, value: 'm' },
						color: { id: colorBlack.id, value: 'black' },
						stock: 9,
						price: 0
					},
					{
						sku: 'LUM-TSHIRT-002-L-BLU',
						size: { id: sizeL.id, value: 'l' },
						color: { id: colorBlue.id, value: 'blue' },
						stock: 6,
						price: 100
					}
				]
			},
			{
				sku: 'LUM-TSHIRT-003',
				name: 'Свободная футболка с принтом',
				slug: 'relaxed-graphic-tee',
				price: 2499,
				imagesUrls: [img('product-graphic-tee-1'), img('product-graphic-tee-2')],
				isPopular: true,
				status: 'ACTIVE',
				position: 9,
				categories: [categoryTshirts.id, categoryMen.id],
				attributes: {
					brand: brandNova,
					material: 'Хлопковый джерси',
					fit: fitOversize,
					gender: genderUnisex,
					season: seasonSummer
				},
				variants: [
					{
						sku: 'LUM-TSHIRT-003-S-BLK',
						size: { id: sizeS.id, value: 's' },
						color: { id: colorBlack.id, value: 'black' },
						stock: 8,
						price: 0
					},
					{
						sku: 'LUM-TSHIRT-003-M-WHT',
						size: { id: sizeM.id, value: 'm' },
						color: { id: colorWhite.id, value: 'white' },
						stock: 7,
						price: 0
					},
					{
						sku: 'LUM-TSHIRT-003-L-RED',
						size: { id: sizeL.id, value: 'l' },
						color: { id: colorRed.id, value: 'red' },
						stock: 5,
						price: 120
					}
				]
			},
			{
				sku: 'LUM-TSHIRT-004',
				name: 'Футболка с длинным рукавом',
				slug: 'long-sleeve-tee',
				price: 2599,
				imagesUrls: [img('product-longsleeve-tee-1')],
				isPopular: false,
				status: 'ACTIVE',
				position: 10,
				categories: [categoryTshirts.id, categoryMen.id],
				attributes: {
					brand: brandLumen,
					material: 'Хлопковый риб',
					fit: fitRegular,
					gender: genderMen,
					season: seasonWinter
				}
			},
			{
				sku: 'LUM-TSHIRT-005',
				name: 'Футболка с карманом',
				slug: 'pocket-tee',
				price: 2199,
				imagesUrls: [img('product-pocket-tee-1')],
				isPopular: false,
				status: 'ACTIVE',
				position: 11,
				categories: [categoryTshirts.id, categoryMen.id],
				attributes: {
					brand: brandOrbit,
					material: 'Мягкий хлопок',
					fit: fitSlim,
					gender: genderUnisex,
					season: seasonAll
				}
			},
			{
				sku: 'LUM-JEANS-002',
				name: 'Прямые джинсы',
				slug: 'straight-jeans',
				price: 4199,
				imagesUrls: [
					img('product-straight-jeans-1'),
					img('product-straight-jeans-2')
				],
				isPopular: true,
				status: 'ACTIVE',
				position: 12,
				categories: [categoryJeans.id, categoryMen.id],
				attributes: {
					brand: brandLumen,
					material: 'Деним',
					fit: fitRegular,
					gender: genderMen,
					season: seasonAll
				},
				variants: [
					{
						sku: 'LUM-JEANS-002-M-BLU',
						size: { id: sizeM.id, value: 'm' },
						color: { id: colorBlue.id, value: 'blue' },
						stock: 6,
						price: 0
					},
					{
						sku: 'LUM-JEANS-002-L-BLU',
						size: { id: sizeL.id, value: 'l' },
						color: { id: colorBlue.id, value: 'blue' },
						stock: 4,
						price: 0
					}
				]
			},
			{
				sku: 'LUM-JEANS-003',
				name: 'Свободные джинсы',
				slug: 'relaxed-jeans',
				price: 4099,
				imagesUrls: [img('product-relaxed-jeans-1')],
				isPopular: false,
				status: 'ACTIVE',
				position: 13,
				categories: [categoryJeans.id, categoryMen.id],
				attributes: {
					brand: brandNova,
					material: 'Деним',
					fit: fitRegular,
					gender: genderMen,
					season: seasonAll
				}
			},
			{
				sku: 'LUM-JEANS-004',
				name: 'Черный деним',
				slug: 'black-denim',
				price: 4299,
				imagesUrls: [img('product-black-denim-1')],
				isPopular: false,
				status: 'ACTIVE',
				position: 14,
				categories: [categoryJeans.id, categoryMen.id],
				attributes: {
					brand: brandOrbit,
					material: 'Черный деним',
					fit: fitSlim,
					gender: genderMen,
					season: seasonAll
				}
			},
			{
				sku: 'LUM-HOODIE-002',
				name: 'Худи на молнии',
				slug: 'zip-hoodie',
				price: 4799,
				imagesUrls: [img('product-zip-hoodie-1'), img('product-zip-hoodie-2')],
				isPopular: true,
				status: 'ACTIVE',
				position: 15,
				categories: [categoryHoodies.id, categoryMen.id],
				attributes: {
					brand: brandNova,
					material: 'Флисовый хлопок',
					fit: fitRegular,
					gender: genderUnisex,
					season: seasonWinter
				},
				variants: [
					{
						sku: 'LUM-HOODIE-002-S-BLK',
						size: { id: sizeS.id, value: 's' },
						color: { id: colorBlack.id, value: 'black' },
						stock: 7,
						price: 0
					},
					{
						sku: 'LUM-HOODIE-002-M-BLU',
						size: { id: sizeM.id, value: 'm' },
						color: { id: colorBlue.id, value: 'blue' },
						stock: 5,
						price: 0
					}
				]
			},
			{
				sku: 'LUM-HOODIE-003',
				name: 'Флисовое худи',
				slug: 'fleece-hoodie',
				price: 4999,
				imagesUrls: [img('product-fleece-hoodie-1')],
				isPopular: false,
				status: 'ACTIVE',
				position: 16,
				categories: [categoryHoodies.id, categoryMen.id],
				attributes: {
					brand: brandLumen,
					material: 'Мягкий флис',
					fit: fitOversize,
					gender: genderUnisex,
					season: seasonWinter
				}
			},
			{
				sku: 'LUM-HOODIE-004',
				name: 'Легкое худи',
				slug: 'lightweight-hoodie',
				price: 4399,
				imagesUrls: [img('product-lightweight-hoodie-1')],
				isPopular: false,
				status: 'DRAFT',
				position: 17,
				categories: [categoryHoodies.id, categoryMen.id],
				attributes: {
					brand: brandOrbit,
					material: 'Легкий хлопок',
					fit: fitSlim,
					gender: genderMen,
					season: seasonSummer
				}
			},
			{
				sku: 'LUM-DRESS-002',
				name: 'Платье на запах',
				slug: 'wrap-dress',
				price: 6499,
				imagesUrls: [img('product-wrap-dress-1'), img('product-wrap-dress-2')],
				isPopular: true,
				status: 'ACTIVE',
				position: 18,
				categories: [categoryDresses.id, categoryWomen.id],
				attributes: {
					brand: brandLumen,
					material: 'Вискоза',
					fit: fitSlim,
					gender: genderWomen,
					season: seasonSummer
				},
				variants: [
					{
						sku: 'LUM-DRESS-002-S-RED',
						size: { id: sizeS.id, value: 's' },
						color: { id: colorRed.id, value: 'red' },
						stock: 5,
						price: 0
					},
					{
						sku: 'LUM-DRESS-002-M-BLK',
						size: { id: sizeM.id, value: 'm' },
						color: { id: colorBlack.id, value: 'black' },
						stock: 4,
						price: 0
					}
				]
			},
			{
				sku: 'LUM-DRESS-003',
				name: 'Платье-комбинация',
				slug: 'slip-dress',
				price: 5599,
				imagesUrls: [img('product-slip-dress-1')],
				isPopular: false,
				status: 'ACTIVE',
				position: 19,
				categories: [categoryDresses.id, categoryWomen.id],
				attributes: {
					brand: brandNova,
					material: 'Сатин',
					fit: fitSlim,
					gender: genderWomen,
					season: seasonSummer
				}
			},
			{
				sku: 'LUM-DRESS-004',
				name: 'Платье миди',
				slug: 'midi-dress',
				price: 6299,
				imagesUrls: [img('product-midi-dress-1')],
				isPopular: false,
				status: 'ACTIVE',
				position: 20,
				categories: [categoryDresses.id, categoryWomen.id],
				attributes: {
					brand: brandOrbit,
					material: 'Хлопковый поплин',
					fit: fitRegular,
					gender: genderWomen,
					season: seasonAll
				}
			},
			{
				sku: 'LUM-TOP-002',
				name: 'Рифленая майка',
				slug: 'ribbed-tank',
				price: 1999,
				imagesUrls: [img('product-ribbed-tank-1')],
				isPopular: false,
				status: 'ACTIVE',
				position: 21,
				categories: [categoryTops.id, categoryWomen.id],
				attributes: {
					brand: brandLumen,
					material: 'Рифленый хлопок',
					fit: fitSlim,
					gender: genderWomen,
					season: seasonSummer
				}
			},
			{
				sku: 'LUM-TOP-003',
				name: 'Кружевная блуза',
				slug: 'lace-blouse',
				price: 3499,
				imagesUrls: [img('product-lace-blouse-1')],
				isPopular: false,
				status: 'ACTIVE',
				position: 22,
				categories: [categoryTops.id, categoryWomen.id],
				attributes: {
					brand: brandNova,
					material: 'Кружевная смесь',
					fit: fitRegular,
					gender: genderWomen,
					season: seasonSummer
				}
			},
			{
				sku: 'LUM-TOP-004',
				name: 'Рубашка на пуговицах',
				slug: 'button-shirt',
				price: 2999,
				imagesUrls: [img('product-button-shirt-1')],
				isPopular: false,
				status: 'ARCHIVED',
				position: 23,
				categories: [categoryTops.id, categoryWomen.id],
				attributes: {
					brand: brandOrbit,
					material: 'Смесь хлопка',
					fit: fitRegular,
					gender: genderWomen,
					season: seasonAll
				}
			},
			{
				sku: 'LUM-ACC-001',
				name: 'Холщовая кепка',
				slug: 'canvas-cap',
				price: 1499,
				imagesUrls: [img('product-canvas-cap-1')],
				isPopular: false,
				status: 'ACTIVE',
				position: 24,
				categories: [categoryAccessories.id, categoryMen.id],
				attributes: {
					brand: brandLumen,
					material: 'Канвас',
					fit: fitRegular,
					gender: genderUnisex,
					season: seasonSummer
				},
				variants: [
					{
						sku: 'LUM-ACC-001-S-WHT',
						size: { id: sizeS.id, value: 's' },
						color: { id: colorWhite.id, value: 'white' },
						stock: 10,
						price: 0
					},
					{
						sku: 'LUM-ACC-001-M-BLK',
						size: { id: sizeM.id, value: 'm' },
						color: { id: colorBlack.id, value: 'black' },
						stock: 7,
						price: 0
					}
				]
			},
			{
				sku: 'LUM-ACC-002',
				name: 'Кожаный ремень',
				slug: 'leather-belt',
				price: 2499,
				imagesUrls: [img('product-leather-belt-1')],
				isPopular: false,
				status: 'ACTIVE',
				position: 25,
				categories: [categoryAccessories.id, categoryMen.id],
				attributes: {
					brand: brandLumen,
					material: 'Кожа',
					fit: fitRegular,
					gender: genderMen,
					season: seasonAll
				}
			},
			{
				sku: 'LUM-ACC-003',
				name: 'Шерстяной шарф',
				slug: 'wool-scarf',
				price: 2799,
				imagesUrls: [img('product-wool-scarf-1')],
				isPopular: false,
				status: 'ACTIVE',
				position: 26,
				categories: [categoryAccessories.id, categoryWomen.id],
				attributes: {
					brand: brandNova,
					material: 'Шерсть',
					fit: fitRegular,
					gender: genderWomen,
					season: seasonWinter
				}
			},
			{
				sku: 'LUM-ACC-004',
				name: 'Носки (3 пары)',
				slug: 'crew-socks-3-pack',
				price: 999,
				imagesUrls: [img('product-crew-socks-1')],
				isPopular: false,
				status: 'ACTIVE',
				position: 27,
				categories: [categoryAccessories.id, categoryMen.id, categoryWomen.id],
				attributes: {
					brand: brandOrbit,
					material: 'Смесь хлопка',
					fit: fitRegular,
					gender: genderUnisex,
					season: seasonAll
				}
			},
			{
				sku: 'LUM-ACC-005',
				name: 'Мини-кроссбоди',
				slug: 'mini-crossbody',
				price: 3299,
				imagesUrls: [img('product-mini-crossbody-1')],
				isPopular: true,
				status: 'ACTIVE',
				position: 28,
				categories: [categoryAccessories.id, categoryWomen.id],
				attributes: {
					brand: brandLumen,
					material: 'Кожа',
					fit: fitRegular,
					gender: genderWomen,
					season: seasonAll
				}
			}
		]

	const lumenExtraProducts: {
		product: { id: string; name: string; price: Prisma.Decimal | number }
		categories: string[]
		attributes: {
			brand: { id: string }
			material: string
			fit: { id: string }
			gender: { id: string }
			season: { id: string }
		}
		variants?: {
			sku: string
			size: { id: string; value: string }
			color: { id: string; value: string }
			stock: number
			price: number
		}[]
	}[] = []

	for (const definition of lumenExtraProductDefinitions) {
		const { categories, attributes, variants, ...productData } = definition
		const product = await prisma.product.create({
			data: {
				catalogId: catalogLumen.id,
				...productData
			}
		})
		lumenExtraProducts.push({
			product: { id: product.id, name: product.name, price: product.price },
			categories,
			attributes,
			variants
		})
	}

	const productOutletTshirt = await prisma.product.create({
		data: {
			catalogId: catalogLumenOutlet.id,
			sku: 'OUT-TSHIRT-001',
			name: 'Футболка из аутлета',
			slug: 'outlet-tshirt',
			price: outletTshirtPrice,
			imagesUrls: [img('product-outlet-tshirt-1')],
			isPopular: true,
			status: 'ACTIVE',
			position: 1
		}
	})
	const productOutletJacket = await prisma.product.create({
		data: {
			catalogId: catalogLumenOutlet.id,
			sku: 'OUT-JACKET-001',
			name: 'Куртка из аутлета',
			slug: 'outlet-jacket',
			price: outletJacketPrice,
			imagesUrls: [img('product-outlet-jacket-1')],
			isPopular: true,
			status: 'ACTIVE',
			position: 2
		}
	})
	const productOutletJeans = await prisma.product.create({
		data: {
			catalogId: catalogLumenOutlet.id,
			sku: 'OUT-JEANS-001',
			name: 'Джинсы из аутлета',
			slug: 'outlet-jeans',
			price: outletJeansPrice,
			imagesUrls: [img('product-outlet-jeans-1')],
			isPopular: false,
			status: 'ARCHIVED',
			position: 3
		}
	})
	const productBurger = await prisma.product.create({
		data: {
			catalogId: catalogGreen.id,
			sku: 'GRN-BURGER-001',
			name: 'Классический бургер',
			slug: 'classic-burger',
			price: burgerPrice,
			imagesUrls: [img('product-burger-1'), img('product-burger-2')],
			isPopular: true,
			status: 'ACTIVE',
			position: 1
		}
	})
	const productSalad = await prisma.product.create({
		data: {
			catalogId: catalogGreen.id,
			sku: 'GRN-SALAD-001',
			name: 'Веганский салат',
			slug: 'vegan-salad',
			price: saladPrice,
			imagesUrls: [img('product-salad-1'), img('product-salad-2')],
			isPopular: false,
			status: 'ACTIVE',
			position: 2
		}
	})
	const productWrap = await prisma.product.create({
		data: {
			catalogId: catalogGreen.id,
			sku: 'GRN-WRAP-001',
			name: 'Куриный ролл',
			slug: 'chicken-wrap',
			price: wrapPrice,
			imagesUrls: [img('product-wrap-1'), img('product-wrap-2')],
			isPopular: true,
			status: 'ACTIVE',
			position: 3
		}
	})
	const productJuice = await prisma.product.create({
		data: {
			catalogId: catalogGreen.id,
			sku: 'GRN-JUICE-001',
			name: 'Свежий сок',
			slug: 'fresh-juice',
			price: juicePrice,
			imagesUrls: [img('product-juice-1')],
			isPopular: false,
			status: 'ACTIVE',
			position: 4
		}
	})
	const productCake = await prisma.product.create({
		data: {
			catalogId: catalogGreen.id,
			sku: 'GRN-CAKE-001',
			name: 'Шоколадный торт',
			slug: 'chocolate-cake',
			price: cakePrice,
			imagesUrls: [img('product-cake-1')],
			isPopular: true,
			status: 'ACTIVE',
			position: 5
		}
	})
	const productEspresso = await prisma.product.create({
		data: {
			catalogId: catalogUrban.id,
			sku: 'URB-ESP-001',
			name: 'Эспрессо',
			slug: 'espresso',
			price: espressoPrice,
			imagesUrls: [img('product-espresso-1')],
			isPopular: true,
			status: 'ACTIVE',
			position: 1
		}
	})
	const productCappuccino = await prisma.product.create({
		data: {
			catalogId: catalogUrban.id,
			sku: 'URB-CAP-001',
			name: 'Капучино',
			slug: 'cappuccino',
			price: cappuccinoPrice,
			imagesUrls: [img('product-cappuccino-1')],
			isPopular: true,
			status: 'ACTIVE',
			position: 2
		}
	})
	const productCroissant = await prisma.product.create({
		data: {
			catalogId: catalogUrban.id,
			sku: 'URB-CRO-001',
			name: 'Круассан с маслом',
			slug: 'butter-croissant',
			price: croissantPrice,
			imagesUrls: [img('product-croissant-1')],
			isPopular: false,
			status: 'ACTIVE',
			position: 3
		}
	})
	const productPhone = await prisma.product.create({
		data: {
			catalogId: catalogNova.id,
			sku: 'NOV-PHONE-001',
			name: 'Смартфон Nova X',
			slug: 'nova-phone-x',
			price: phonePrice,
			imagesUrls: [img('product-phone-1'), img('product-phone-2')],
			isPopular: true,
			status: 'ACTIVE',
			position: 1
		}
	})
	const productLaptop = await prisma.product.create({
		data: {
			catalogId: catalogNova.id,
			sku: 'NOV-LAP-001',
			name: 'Ноутбук Nova Air',
			slug: 'nova-laptop-air',
			price: laptopPrice,
			imagesUrls: [img('product-laptop-1')],
			isPopular: true,
			status: 'ACTIVE',
			position: 2
		}
	})
	const productEarbuds = await prisma.product.create({
		data: {
			catalogId: catalogNova.id,
			sku: 'NOV-EAR-001',
			name: 'Наушники Nova',
			slug: 'nova-earbuds',
			price: earbudsPrice,
			imagesUrls: [img('product-earbuds-1')],
			isPopular: false,
			status: 'ACTIVE',
			position: 3
		}
	})
	const productSerum = await prisma.product.create({
		data: {
			catalogId: catalogGlow.id,
			sku: 'GLW-SER-001',
			name: 'Сыворотка Glow',
			slug: 'glow-serum',
			price: serumPrice,
			imagesUrls: [img('product-serum-1')],
			isPopular: true,
			status: 'ACTIVE',
			position: 1
		}
	})
	const productLipstick = await prisma.product.create({
		data: {
			catalogId: catalogGlow.id,
			sku: 'GLW-LIP-001',
			name: 'Помада Velvet',
			slug: 'velvet-lipstick',
			price: lipstickPrice,
			imagesUrls: [img('product-lipstick-1')],
			isPopular: true,
			status: 'ACTIVE',
			position: 2
		}
	})
	const productNudeLipstick = await prisma.product.create({
		data: {
			catalogId: catalogGlow.id,
			sku: 'GLW-LIP-002',
			name: 'Помада Nude',
			slug: 'nude-lipstick',
			price: lipstickPrice,
			imagesUrls: [img('product-lipstick-nude-1')],
			isPopular: false,
			status: 'ACTIVE',
			position: 3
		}
	})
	const productRoseBlush = await prisma.product.create({
		data: {
			catalogId: catalogGlow.id,
			sku: 'GLW-BLS-001',
			name: 'Румяна Rose',
			slug: 'rose-blush',
			price: lipstickPrice,
			imagesUrls: [img('product-blush-rose-1')],
			isPopular: false,
			status: 'ACTIVE',
			position: 4
		}
	})
	const productCleanser = await prisma.product.create({
		data: {
			catalogId: catalogGlow.id,
			sku: 'GLW-CLN-001',
			name: 'Ежедневный гель для умывания',
			slug: 'daily-cleanser',
			price: cleanserPrice,
			imagesUrls: [img('product-cleanser-1')],
			isPopular: false,
			status: 'DRAFT',
			position: 5
		}
	})

	const lumenExtraCategoryPositions = new Map<string, number>()
	const nextLumenCategoryPosition = (categoryId: string) => {
		const next = (lumenExtraCategoryPositions.get(categoryId) ?? 9) + 1
		lumenExtraCategoryPositions.set(categoryId, next)
		return next
	}

	const lumenExtraCategoryProducts = lumenExtraProducts.flatMap(item =>
		item.categories.map(categoryId => ({
			categoryId,
			productId: item.product.id,
			position: nextLumenCategoryPosition(categoryId)
		}))
	)

	await prisma.categoryProduct.createMany({
		data: [
			{ categoryId: categoryTshirts.id, productId: productTshirt.id, position: 1 },
			{ categoryId: categoryJeans.id, productId: productJeans.id, position: 2 },
			{ categoryId: categoryHoodies.id, productId: productHoodie.id, position: 3 },
			{ categoryId: categoryMen.id, productId: productLinenShirt.id, position: 4 },
			{ categoryId: categoryDresses.id, productId: productDress.id, position: 5 },
			{ categoryId: categoryTops.id, productId: productSilkTop.id, position: 6 },
			{
				categoryId: categoryAccessories.id,
				productId: productTote.id,
				position: 7
			},
			{
				categoryId: categoryOutletSale.id,
				productId: productOutletTshirt.id,
				position: 1
			},
			{
				categoryId: categoryOutletSale.id,
				productId: productOutletJacket.id,
				position: 2
			},
			{
				categoryId: categoryOutletLastChance.id,
				productId: productOutletJeans.id,
				position: 3
			},
			{ categoryId: categoryBurgers.id, productId: productBurger.id, position: 1 },
			{ categoryId: categorySalads.id, productId: productSalad.id, position: 2 },
			{ categoryId: categoryBurgers.id, productId: productWrap.id, position: 3 },
			{ categoryId: categoryDrinks.id, productId: productJuice.id, position: 4 },
			{ categoryId: categoryDesserts.id, productId: productCake.id, position: 5 },
			{
				categoryId: categoryCoffee.id,
				productId: productEspresso.id,
				position: 1
			},
			{
				categoryId: categoryCoffee.id,
				productId: productCappuccino.id,
				position: 2
			},
			{
				categoryId: categoryPastries.id,
				productId: productCroissant.id,
				position: 3
			},
			{ categoryId: categoryPhones.id, productId: productPhone.id, position: 1 },
			{ categoryId: categoryLaptops.id, productId: productLaptop.id, position: 2 },
			{
				categoryId: categoryGadgets.id,
				productId: productEarbuds.id,
				position: 3
			},
			{ categoryId: categorySkincare.id, productId: productSerum.id, position: 1 },
			{
				categoryId: categoryMakeup.id,
				productId: productLipstick.id,
				position: 2
			},
			{
				categoryId: categoryMakeup.id,
				productId: productNudeLipstick.id,
				position: 3
			},
			{
				categoryId: categoryMakeup.id,
				productId: productRoseBlush.id,
				position: 4
			},
			{
				categoryId: categorySkincare.id,
				productId: productCleanser.id,
				position: 5
			},
			...lumenExtraCategoryProducts
		]
	})

	const discountStartAt = new Date('2026-02-01T00:00:00.000Z')
	const discountEndAt = new Date('2026-02-15T00:00:00.000Z')

	const clothingProducts = [
		productTshirt,
		productJeans,
		productHoodie,
		productLinenShirt,
		productDress,
		productSilkTop,
		productTote,
		...lumenExtraProducts.map(item => item.product),
		productOutletTshirt,
		productOutletJacket,
		productOutletJeans
	]
	const restaurantProducts = [
		productBurger,
		productSalad,
		productWrap,
		productJuice,
		productCake,
		productEspresso,
		productCappuccino,
		productCroissant
	]
	const electronicsProducts = [productPhone, productLaptop, productEarbuds]
	const beautyProducts = [
		productSerum,
		productLipstick,
		productNudeLipstick,
		productRoseBlush,
		productCleanser
	]

	const commonAttributeValues = [
		...buildCommonProductAttributeValues(
			clothingProducts,
			commonClothingAttributes,
			{
				discount: 15,
				start: discountStartAt,
				end: discountEndAt
			}
		),
		...buildCommonProductAttributeValues(
			restaurantProducts,
			commonRestaurantAttributes,
			{
				discount: 10,
				start: discountStartAt,
				end: discountEndAt
			}
		),
		...buildCommonProductAttributeValues(
			electronicsProducts,
			commonElectronicsAttributes,
			{
				discount: 5,
				start: discountStartAt,
				end: discountEndAt
			}
		),
		...buildCommonProductAttributeValues(beautyProducts, commonBeautyAttributes, {
			discount: 20,
			start: discountStartAt,
			end: discountEndAt
		})
	]

	const lumenExtraAttributeValues = lumenExtraProducts.flatMap(item => [
		{
			productId: item.product.id,
			attributeId: attrBrand.id,
			enumValueId: item.attributes.brand.id
		},
		{
			productId: item.product.id,
			attributeId: attrMaterial.id,
			valueString: item.attributes.material
		},
		{
			productId: item.product.id,
			attributeId: attrFit.id,
			enumValueId: item.attributes.fit.id
		},
		{
			productId: item.product.id,
			attributeId: attrGender.id,
			enumValueId: item.attributes.gender.id
		},
		{
			productId: item.product.id,
			attributeId: attrSeason.id,
			enumValueId: item.attributes.season.id
		}
	])
	const restaurantBrandValues = [
		{
			productId: productBurger.id,
			attributeId: attrRestaurantBrand.id,
			enumValueId: brandGreen.id
		},
		{
			productId: productSalad.id,
			attributeId: attrRestaurantBrand.id,
			enumValueId: brandGreen.id
		},
		{
			productId: productWrap.id,
			attributeId: attrRestaurantBrand.id,
			enumValueId: brandGreen.id
		},
		{
			productId: productJuice.id,
			attributeId: attrRestaurantBrand.id,
			enumValueId: brandGreen.id
		},
		{
			productId: productCake.id,
			attributeId: attrRestaurantBrand.id,
			enumValueId: brandGreen.id
		},
		{
			productId: productEspresso.id,
			attributeId: attrRestaurantBrand.id,
			enumValueId: brandUrban.id
		},
		{
			productId: productCappuccino.id,
			attributeId: attrRestaurantBrand.id,
			enumValueId: brandUrban.id
		},
		{
			productId: productCroissant.id,
			attributeId: attrRestaurantBrand.id,
			enumValueId: brandUrban.id
		}
	]

	await prisma.productAttribute.createMany({
		data: [
			{
				productId: productTshirt.id,
				attributeId: attrBrand.id,
				enumValueId: brandLumen.id
			},
			{
				productId: productTshirt.id,
				attributeId: attrMaterial.id,
				valueString: '100% хлопок'
			},
			{
				productId: productTshirt.id,
				attributeId: attrFit.id,
				enumValueId: fitRegular.id
			},
			{
				productId: productTshirt.id,
				attributeId: attrGender.id,
				enumValueId: genderUnisex.id
			},
			{
				productId: productTshirt.id,
				attributeId: attrSeason.id,
				enumValueId: seasonSummer.id
			},
			{
				productId: productJeans.id,
				attributeId: attrBrand.id,
				enumValueId: brandLumen.id
			},
			{
				productId: productJeans.id,
				attributeId: attrMaterial.id,
				valueString: '98% хлопок, 2% эластан'
			},
			{
				productId: productJeans.id,
				attributeId: attrFit.id,
				enumValueId: fitSlim.id
			},
			{
				productId: productJeans.id,
				attributeId: attrGender.id,
				enumValueId: genderMen.id
			},
			{
				productId: productJeans.id,
				attributeId: attrSeason.id,
				enumValueId: seasonAll.id
			},
			{
				productId: productHoodie.id,
				attributeId: attrBrand.id,
				enumValueId: brandNova.id
			},
			{
				productId: productHoodie.id,
				attributeId: attrMaterial.id,
				valueString: '80% хлопок, 20% полиэстер'
			},
			{
				productId: productHoodie.id,
				attributeId: attrFit.id,
				enumValueId: fitOversize.id
			},
			{
				productId: productHoodie.id,
				attributeId: attrGender.id,
				enumValueId: genderUnisex.id
			},
			{
				productId: productHoodie.id,
				attributeId: attrSeason.id,
				enumValueId: seasonWinter.id
			},
			{
				productId: productLinenShirt.id,
				attributeId: attrBrand.id,
				enumValueId: brandLumen.id
			},
			{
				productId: productLinenShirt.id,
				attributeId: attrMaterial.id,
				valueString: '100% лен'
			},
			{
				productId: productLinenShirt.id,
				attributeId: attrFit.id,
				enumValueId: fitRegular.id
			},
			{
				productId: productLinenShirt.id,
				attributeId: attrGender.id,
				enumValueId: genderMen.id
			},
			{
				productId: productLinenShirt.id,
				attributeId: attrSeason.id,
				enumValueId: seasonSummer.id
			},
			{
				productId: productDress.id,
				attributeId: attrBrand.id,
				enumValueId: brandOrbit.id
			},
			{
				productId: productDress.id,
				attributeId: attrMaterial.id,
				valueString: 'Смесь вискозы'
			},
			{
				productId: productDress.id,
				attributeId: attrFit.id,
				enumValueId: fitRegular.id
			},
			{
				productId: productDress.id,
				attributeId: attrGender.id,
				enumValueId: genderWomen.id
			},
			{
				productId: productDress.id,
				attributeId: attrSeason.id,
				enumValueId: seasonSummer.id
			},
			{
				productId: productSilkTop.id,
				attributeId: attrBrand.id,
				enumValueId: brandNova.id
			},
			{
				productId: productSilkTop.id,
				attributeId: attrMaterial.id,
				valueString: 'Шелковая смесь'
			},
			{
				productId: productSilkTop.id,
				attributeId: attrFit.id,
				enumValueId: fitSlim.id
			},
			{
				productId: productSilkTop.id,
				attributeId: attrGender.id,
				enumValueId: genderWomen.id
			},
			{
				productId: productSilkTop.id,
				attributeId: attrSeason.id,
				enumValueId: seasonSummer.id
			},
			{
				productId: productTote.id,
				attributeId: attrBrand.id,
				enumValueId: brandLumen.id
			},
			{
				productId: productTote.id,
				attributeId: attrMaterial.id,
				valueString: 'Канвас'
			},
			{
				productId: productTote.id,
				attributeId: attrFit.id,
				enumValueId: fitRegular.id
			},
			{
				productId: productTote.id,
				attributeId: attrGender.id,
				enumValueId: genderUnisex.id
			},
			{
				productId: productTote.id,
				attributeId: attrSeason.id,
				enumValueId: seasonAll.id
			},
			{
				productId: productOutletTshirt.id,
				attributeId: attrBrand.id,
				enumValueId: brandLumen.id
			},
			{
				productId: productOutletTshirt.id,
				attributeId: attrMaterial.id,
				valueString: 'Смесь хлопка'
			},
			{
				productId: productOutletTshirt.id,
				attributeId: attrFit.id,
				enumValueId: fitRegular.id
			},
			{
				productId: productOutletTshirt.id,
				attributeId: attrGender.id,
				enumValueId: genderUnisex.id
			},
			{
				productId: productOutletTshirt.id,
				attributeId: attrSeason.id,
				enumValueId: seasonAll.id
			},
			{
				productId: productOutletJacket.id,
				attributeId: attrBrand.id,
				enumValueId: brandNova.id
			},
			{
				productId: productOutletJacket.id,
				attributeId: attrMaterial.id,
				valueString: 'Нейлоновая оболочка'
			},
			{
				productId: productOutletJacket.id,
				attributeId: attrFit.id,
				enumValueId: fitRegular.id
			},
			{
				productId: productOutletJacket.id,
				attributeId: attrGender.id,
				enumValueId: genderMen.id
			},
			{
				productId: productOutletJacket.id,
				attributeId: attrSeason.id,
				enumValueId: seasonWinter.id
			},
			{
				productId: productOutletJeans.id,
				attributeId: attrBrand.id,
				enumValueId: brandLumen.id
			},
			{
				productId: productOutletJeans.id,
				attributeId: attrMaterial.id,
				valueString: 'Деним'
			},
			{
				productId: productOutletJeans.id,
				attributeId: attrFit.id,
				enumValueId: fitSlim.id
			},
			{
				productId: productOutletJeans.id,
				attributeId: attrGender.id,
				enumValueId: genderMen.id
			},
			{
				productId: productOutletJeans.id,
				attributeId: attrSeason.id,
				enumValueId: seasonAll.id
			},
			{
				productId: productBurger.id,
				attributeId: attrIngredients.id,
				valueString: 'Говядина, булка, салат, томат, соус'
			},
			{
				productId: productBurger.id,
				attributeId: attrCalories.id,
				valueInteger: 580
			},
			{
				productId: productBurger.id,
				attributeId: attrIsVegan.id,
				valueBoolean: false
			},
			{
				productId: productBurger.id,
				attributeId: attrWeight.id,
				valueDecimal: new Prisma.Decimal(0.35)
			},
			{
				productId: productBurger.id,
				attributeId: attrSpicy.id,
				enumValueId: spicyMedium.id
			},
			{
				productId: productBurger.id,
				attributeId: attrAllergens.id,
				valueString: 'глютен'
			},
			{
				productId: productBurger.id,
				attributeId: attrCookingTime.id,
				valueInteger: 12
			},
			{
				productId: productSalad.id,
				attributeId: attrIngredients.id,
				valueString: 'Смесь салатов, авокадо, огурец, семена'
			},
			{
				productId: productSalad.id,
				attributeId: attrCalories.id,
				valueInteger: 320
			},
			{
				productId: productSalad.id,
				attributeId: attrIsVegan.id,
				valueBoolean: true
			},
			{
				productId: productSalad.id,
				attributeId: attrWeight.id,
				valueDecimal: new Prisma.Decimal(0.28)
			},
			{
				productId: productSalad.id,
				attributeId: attrSpicy.id,
				enumValueId: spicyMild.id
			},
			{
				productId: productSalad.id,
				attributeId: attrAllergens.id,
				valueString: 'орехи'
			},
			{
				productId: productSalad.id,
				attributeId: attrCookingTime.id,
				valueInteger: 6
			},
			{
				productId: productWrap.id,
				attributeId: attrIngredients.id,
				valueString: 'Курица, тортилья, салат, соус'
			},
			{
				productId: productWrap.id,
				attributeId: attrCalories.id,
				valueInteger: 520
			},
			{
				productId: productWrap.id,
				attributeId: attrIsVegan.id,
				valueBoolean: false
			},
			{
				productId: productWrap.id,
				attributeId: attrWeight.id,
				valueDecimal: new Prisma.Decimal(0.32)
			},
			{
				productId: productWrap.id,
				attributeId: attrSpicy.id,
				enumValueId: spicyHot.id
			},
			{
				productId: productWrap.id,
				attributeId: attrAllergens.id,
				valueString: 'глютен'
			},
			{
				productId: productWrap.id,
				attributeId: attrCookingTime.id,
				valueInteger: 8
			},
			{
				productId: productJuice.id,
				attributeId: attrIngredients.id,
				valueString: 'Яблоко, имбирь, лимон'
			},
			{
				productId: productJuice.id,
				attributeId: attrCalories.id,
				valueInteger: 120
			},
			{
				productId: productJuice.id,
				attributeId: attrIsVegan.id,
				valueBoolean: true
			},
			{
				productId: productJuice.id,
				attributeId: attrWeight.id,
				valueDecimal: new Prisma.Decimal(0.25)
			},
			{
				productId: productJuice.id,
				attributeId: attrSpicy.id,
				enumValueId: spicyMild.id
			},
			{
				productId: productJuice.id,
				attributeId: attrAllergens.id,
				valueString: 'нет'
			},
			{
				productId: productJuice.id,
				attributeId: attrCookingTime.id,
				valueInteger: 2
			},
			{
				productId: productCake.id,
				attributeId: attrIngredients.id,
				valueString: 'Какао, мука, сахар, масло'
			},
			{
				productId: productCake.id,
				attributeId: attrCalories.id,
				valueInteger: 420
			},
			{
				productId: productCake.id,
				attributeId: attrIsVegan.id,
				valueBoolean: false
			},
			{
				productId: productCake.id,
				attributeId: attrWeight.id,
				valueDecimal: new Prisma.Decimal(0.18)
			},
			{
				productId: productCake.id,
				attributeId: attrSpicy.id,
				enumValueId: spicyMild.id
			},
			{
				productId: productCake.id,
				attributeId: attrAllergens.id,
				valueString: 'глютен, молочные продукты, яйца'
			},
			{
				productId: productCake.id,
				attributeId: attrCookingTime.id,
				valueInteger: 15
			},
			{
				productId: productEspresso.id,
				attributeId: attrIngredients.id,
				valueString: 'Зерна арабики, вода'
			},
			{
				productId: productEspresso.id,
				attributeId: attrCalories.id,
				valueInteger: 5
			},
			{
				productId: productEspresso.id,
				attributeId: attrIsVegan.id,
				valueBoolean: true
			},
			{
				productId: productEspresso.id,
				attributeId: attrWeight.id,
				valueDecimal: new Prisma.Decimal(0.08)
			},
			{
				productId: productEspresso.id,
				attributeId: attrSpicy.id,
				enumValueId: spicyMild.id
			},
			{
				productId: productEspresso.id,
				attributeId: attrAllergens.id,
				valueString: 'нет'
			},
			{
				productId: productEspresso.id,
				attributeId: attrCookingTime.id,
				valueInteger: 3
			},
			{
				productId: productCappuccino.id,
				attributeId: attrIngredients.id,
				valueString: 'Кофе, молоко, пена'
			},
			{
				productId: productCappuccino.id,
				attributeId: attrCalories.id,
				valueInteger: 120
			},
			{
				productId: productCappuccino.id,
				attributeId: attrIsVegan.id,
				valueBoolean: false
			},
			{
				productId: productCappuccino.id,
				attributeId: attrWeight.id,
				valueDecimal: new Prisma.Decimal(0.18)
			},
			{
				productId: productCappuccino.id,
				attributeId: attrSpicy.id,
				enumValueId: spicyMild.id
			},
			{
				productId: productCappuccino.id,
				attributeId: attrAllergens.id,
				valueString: 'молочные продукты'
			},
			{
				productId: productCappuccino.id,
				attributeId: attrCookingTime.id,
				valueInteger: 4
			},
			{
				productId: productCroissant.id,
				attributeId: attrIngredients.id,
				valueString: 'Масло, мука, сахар'
			},
			{
				productId: productCroissant.id,
				attributeId: attrCalories.id,
				valueInteger: 260
			},
			{
				productId: productCroissant.id,
				attributeId: attrIsVegan.id,
				valueBoolean: false
			},
			{
				productId: productCroissant.id,
				attributeId: attrWeight.id,
				valueDecimal: new Prisma.Decimal(0.12)
			},
			{
				productId: productCroissant.id,
				attributeId: attrSpicy.id,
				enumValueId: spicyMild.id
			},
			{
				productId: productCroissant.id,
				attributeId: attrAllergens.id,
				valueString: 'глютен, молочные продукты'
			},
			{
				productId: productCroissant.id,
				attributeId: attrCookingTime.id,
				valueInteger: 5
			},
			{
				productId: productPhone.id,
				attributeId: attrTechBrand.id,
				enumValueId: techBrandNova.id
			},
			{
				productId: productPhone.id,
				attributeId: attrTechColor.id,
				enumValueId: techColorBlack.id
			},
			{
				productId: productPhone.id,
				attributeId: attrScreenSize.id,
				valueDecimal: new Prisma.Decimal(6.5)
			},
			{
				productId: productPhone.id,
				attributeId: attrMemory.id,
				valueInteger: 8
			},
			{
				productId: productPhone.id,
				attributeId: attrStorage.id,
				valueInteger: 256
			},
			{
				productId: productPhone.id,
				attributeId: attrBattery.id,
				valueInteger: 4500
			},
			{
				productId: productPhone.id,
				attributeId: attrRefurb.id,
				valueBoolean: false
			},
			{
				productId: productPhone.id,
				attributeId: attrWarranty.id,
				valueInteger: 24
			},
			{
				productId: productLaptop.id,
				attributeId: attrTechBrand.id,
				enumValueId: techBrandOrbit.id
			},
			{
				productId: productLaptop.id,
				attributeId: attrTechColor.id,
				enumValueId: techColorSilver.id
			},
			{
				productId: productLaptop.id,
				attributeId: attrScreenSize.id,
				valueDecimal: new Prisma.Decimal(14)
			},
			{
				productId: productLaptop.id,
				attributeId: attrMemory.id,
				valueInteger: 16
			},
			{
				productId: productLaptop.id,
				attributeId: attrStorage.id,
				valueInteger: 512
			},
			{
				productId: productLaptop.id,
				attributeId: attrBattery.id,
				valueInteger: 6200
			},
			{
				productId: productLaptop.id,
				attributeId: attrRefurb.id,
				valueBoolean: false
			},
			{
				productId: productLaptop.id,
				attributeId: attrWarranty.id,
				valueInteger: 24
			},
			{
				productId: productEarbuds.id,
				attributeId: attrTechBrand.id,
				enumValueId: techBrandPhoton.id
			},
			{
				productId: productEarbuds.id,
				attributeId: attrTechColor.id,
				enumValueId: techColorBlue.id
			},
			{
				productId: productEarbuds.id,
				attributeId: attrBattery.id,
				valueInteger: 500
			},
			{
				productId: productEarbuds.id,
				attributeId: attrRefurb.id,
				valueBoolean: false
			},
			{
				productId: productEarbuds.id,
				attributeId: attrWarranty.id,
				valueInteger: 12
			},
			{
				productId: productSerum.id,
				attributeId: attrBeautyBrand.id,
				enumValueId: beautyBrandGlow.id
			},
			{
				productId: productSerum.id,
				attributeId: attrBeautyVolume.id,
				valueDecimal: new Prisma.Decimal(30)
			},
			{
				productId: productSerum.id,
				attributeId: attrBeautySkinType.id,
				enumValueId: skinNormal.id
			},
			{
				productId: productSerum.id,
				attributeId: attrBeautyOrganic.id,
				valueBoolean: true
			},
			{
				productId: productLipstick.id,
				attributeId: attrBeautyBrand.id,
				enumValueId: beautyBrandAura.id
			},
			{
				productId: productLipstick.id,
				attributeId: attrBeautyVolume.id,
				valueDecimal: new Prisma.Decimal(4)
			},
			{
				productId: productLipstick.id,
				attributeId: attrBeautySkinType.id,
				enumValueId: skinNormal.id
			},
			{
				productId: productLipstick.id,
				attributeId: attrBeautyOrganic.id,
				valueBoolean: false
			},
			{
				productId: productLipstick.id,
				attributeId: attrBeautyColor.id,
				enumValueId: beautyColorRed.id
			},
			{
				productId: productNudeLipstick.id,
				attributeId: attrBeautyBrand.id,
				enumValueId: beautyBrandAura.id
			},
			{
				productId: productNudeLipstick.id,
				attributeId: attrBeautyVolume.id,
				valueDecimal: new Prisma.Decimal(4)
			},
			{
				productId: productNudeLipstick.id,
				attributeId: attrBeautySkinType.id,
				enumValueId: skinOily.id
			},
			{
				productId: productNudeLipstick.id,
				attributeId: attrBeautyOrganic.id,
				valueBoolean: false
			},
			{
				productId: productNudeLipstick.id,
				attributeId: attrBeautyColor.id,
				enumValueId: beautyColorNude.id
			},
			{
				productId: productRoseBlush.id,
				attributeId: attrBeautyBrand.id,
				enumValueId: beautyBrandGlow.id
			},
			{
				productId: productRoseBlush.id,
				attributeId: attrBeautyVolume.id,
				valueDecimal: new Prisma.Decimal(6)
			},
			{
				productId: productRoseBlush.id,
				attributeId: attrBeautySkinType.id,
				enumValueId: skinNormal.id
			},
			{
				productId: productRoseBlush.id,
				attributeId: attrBeautyOrganic.id,
				valueBoolean: true
			},
			{
				productId: productRoseBlush.id,
				attributeId: attrBeautyColor.id,
				enumValueId: beautyColorRose.id
			},
			{
				productId: productCleanser.id,
				attributeId: attrBeautyBrand.id,
				enumValueId: beautyBrandGlow.id
			},
			{
				productId: productCleanser.id,
				attributeId: attrBeautyVolume.id,
				valueDecimal: new Prisma.Decimal(150)
			},
			{
				productId: productCleanser.id,
				attributeId: attrBeautySkinType.id,
				enumValueId: skinDry.id
			},
			{
				productId: productCleanser.id,
				attributeId: attrBeautyOrganic.id,
				valueBoolean: true
			},
			...lumenExtraAttributeValues,
			...restaurantBrandValues,
			...commonAttributeValues
		]
	})

	const createVariant = async ({
		productId,
		sku,
		size,
		color,
		stock,
		price
	}: {
		productId: string
		sku: string
		size: { id: string; value: string }
		color: { id: string; value: string }
		stock: number
		price: number
	}) => {
		const status = stock > 0 ? 'ACTIVE' : 'OUT_OF_STOCK'
		const variant = await prisma.productVariant.create({
			data: {
				productId,
				sku,
				variantKey: `size=${size.value};color=${color.value}`,
				stock,
				price,
				status,
				isAvailable: status === 'ACTIVE'
			}
		})

		await prisma.variantAttribute.createMany({
			data: [
				{
					variantId: variant.id,
					attributeId: attrSize.id,
					enumValueId: size.id
				},
				{
					variantId: variant.id,
					attributeId: attrColor.id,
					enumValueId: color.id
				}
			]
		})

		return variant
	}

	for (const item of lumenExtraProducts) {
		if (!item.variants?.length) {
			continue
		}

		for (const variant of item.variants) {
			await createVariant({
				productId: item.product.id,
				...variant
			})
		}
	}

	const variantTshirtSW = await createVariant({
		productId: productTshirt.id,
		sku: 'LUM-TSHIRT-001-S-WHT',
		size: { id: sizeS.id, value: 's' },
		color: { id: colorWhite.id, value: 'white' },
		stock: 12,
		price: 0
	})
	await createVariant({
		productId: productTshirt.id,
		sku: 'LUM-TSHIRT-001-S-BLK',
		size: { id: sizeS.id, value: 's' },
		color: { id: colorBlack.id, value: 'black' },
		stock: 8,
		price: 0
	})
	await createVariant({
		productId: productTshirt.id,
		sku: 'LUM-TSHIRT-001-M-WHT',
		size: { id: sizeM.id, value: 'm' },
		color: { id: colorWhite.id, value: 'white' },
		stock: 6,
		price: 150
	})
	await createVariant({
		productId: productTshirt.id,
		sku: 'LUM-TSHIRT-001-M-BLK',
		size: { id: sizeM.id, value: 'm' },
		color: { id: colorBlack.id, value: 'black' },
		stock: 4,
		price: 150
	})
	await createVariant({
		productId: productTshirt.id,
		sku: 'LUM-TSHIRT-001-L-WHT',
		size: { id: sizeL.id, value: 'l' },
		color: { id: colorWhite.id, value: 'white' },
		stock: 3,
		price: 200
	})
	const variantJeansMB = await createVariant({
		productId: productJeans.id,
		sku: 'LUM-JEANS-001-M-BLU',
		size: { id: sizeM.id, value: 'm' },
		color: { id: colorBlue.id, value: 'blue' },
		stock: 5,
		price: 0
	})
	await createVariant({
		productId: productJeans.id,
		sku: 'LUM-JEANS-001-L-BLU',
		size: { id: sizeL.id, value: 'l' },
		color: { id: colorBlue.id, value: 'blue' },
		stock: 3,
		price: 0
	})
	const variantHoodieMB = await createVariant({
		productId: productHoodie.id,
		sku: 'LUM-HOODIE-001-M-BLK',
		size: { id: sizeM.id, value: 'm' },
		color: { id: colorBlack.id, value: 'black' },
		stock: 7,
		price: 0
	})
	await createVariant({
		productId: productHoodie.id,
		sku: 'LUM-HOODIE-001-L-BLU',
		size: { id: sizeL.id, value: 'l' },
		color: { id: colorBlue.id, value: 'blue' },
		stock: 4,
		price: 0
	})
	await createVariant({
		productId: productLinenShirt.id,
		sku: 'LUM-SHIRT-001-S-WHT',
		size: { id: sizeS.id, value: 's' },
		color: { id: colorWhite.id, value: 'white' },
		stock: 6,
		price: 0
	})
	await createVariant({
		productId: productLinenShirt.id,
		sku: 'LUM-SHIRT-001-M-BLU',
		size: { id: sizeM.id, value: 'm' },
		color: { id: colorBlue.id, value: 'blue' },
		stock: 4,
		price: 0
	})
	const variantTopXS = await createVariant({
		productId: productSilkTop.id,
		sku: 'LUM-TOP-001-XS-WHT',
		size: { id: sizeXs.id, value: 'xs' },
		color: { id: colorWhite.id, value: 'white' },
		stock: 4,
		price: 0
	})
	await createVariant({
		productId: productSilkTop.id,
		sku: 'LUM-TOP-001-XL-RED',
		size: { id: sizeXl.id, value: 'xl' },
		color: { id: colorRed.id, value: 'red' },
		stock: 2,
		price: 100
	})
	const variantDressMR = await createVariant({
		productId: productDress.id,
		sku: 'LUM-DRESS-001-M-RED',
		size: { id: sizeM.id, value: 'm' },
		color: { id: colorRed.id, value: 'red' },
		stock: 5,
		price: 0
	})
	const variantOutletTshirtSB = await createVariant({
		productId: productOutletTshirt.id,
		sku: 'OUT-TSHIRT-001-S-BLK',
		size: { id: sizeS.id, value: 's' },
		color: { id: colorBlack.id, value: 'black' },
		stock: 9,
		price: 0
	})
	await createVariant({
		productId: productOutletJacket.id,
		sku: 'OUT-JACKET-001-M-BLK',
		size: { id: sizeM.id, value: 'm' },
		color: { id: colorBlack.id, value: 'black' },
		stock: 2,
		price: 0
	})
	await createVariant({
		productId: productOutletJeans.id,
		sku: 'OUT-JEANS-001-L-BLU',
		size: { id: sizeL.id, value: 'l' },
		color: { id: colorBlue.id, value: 'blue' },
		stock: 1,
		price: 0
	})

	const cartLumen = await prisma.cart.create({
		data: {
			catalogId: catalogLumen.id,
			userId: shopper.id,
			token: 'cart-seed-1'
		}
	})
	const cartGreen = await prisma.cart.create({
		data: {
			catalogId: catalogGreen.id,
			token: 'cart-seed-2'
		}
	})
	const cartNova = await prisma.cart.create({
		data: {
			catalogId: catalogNova.id,
			userId: shopper2.id,
			token: 'cart-seed-3'
		}
	})
	const cartOutlet = await prisma.cart.create({
		data: {
			catalogId: catalogLumenOutlet.id,
			token: 'cart-seed-4'
		}
	})

	await prisma.cartItem.createMany({
		data: [
			{
				cartId: cartLumen.id,
				productId: productTshirt.id,
				variantId: variantTshirtSW.id,
				quantity: 2
			},
			{
				cartId: cartLumen.id,
				productId: productJeans.id,
				variantId: variantJeansMB.id,
				quantity: 1
			},
			{
				cartId: cartLumen.id,
				productId: productHoodie.id,
				variantId: variantHoodieMB.id,
				quantity: 1
			},
			{
				cartId: cartLumen.id,
				productId: productDress.id,
				variantId: variantDressMR.id,
				quantity: 1
			},
			{
				cartId: cartLumen.id,
				productId: productSilkTop.id,
				variantId: variantTopXS.id,
				quantity: 1
			},
			{
				cartId: cartGreen.id,
				productId: productBurger.id,
				quantity: 1
			},
			{
				cartId: cartGreen.id,
				productId: productJuice.id,
				quantity: 2
			},
			{
				cartId: cartGreen.id,
				productId: productCake.id,
				quantity: 1
			},
			{
				cartId: cartNova.id,
				productId: productPhone.id,
				quantity: 1
			},
			{
				cartId: cartNova.id,
				productId: productEarbuds.id,
				quantity: 1
			},
			{
				cartId: cartOutlet.id,
				productId: productOutletTshirt.id,
				variantId: variantOutletTshirtSB.id,
				quantity: 1
			}
		]
	})

	const orderGreenTotal = burgerPrice * 2 + saladPrice + wrapPrice
	const orderLumenTotal = tshirtPrice + jeansPrice + hoodiePrice
	const orderNovaTotal = phonePrice + earbudsPrice
	const orderGreen = await prisma.order.create({
		data: {
			status: 'COMPLETED',
			token: 'order-seed-001',
			comment: 'Leave at the door.',
			commentByAdmin: 'Paid in cash.',
			paymentMethod: 'CASH',
			paymentProof: [img('payment-proof-1', 800, 600)],
			products: [
				{
					productId: productBurger.id,
					name: productBurger.name,
					quantity: 2,
					unitPrice: burgerPrice
				},
				{
					productId: productSalad.id,
					name: productSalad.name,
					quantity: 1,
					unitPrice: saladPrice
				},
				{
					productId: productWrap.id,
					name: productWrap.name,
					quantity: 1,
					unitPrice: wrapPrice
				}
			],
			totalAmount: orderGreenTotal,
			catalogId: catalogGreen.id
		}
	})
	const orderLumen = await prisma.order.create({
		data: {
			status: 'PENDING',
			token: 'order-seed-002',
			comment: 'Call on arrival.',
			commentByAdmin: 'Awaiting transfer.',
			paymentMethod: 'TRANSFER',
			paymentProof: [],
			products: [
				{
					productId: productTshirt.id,
					name: productTshirt.name,
					quantity: 1,
					unitPrice: tshirtPrice
				},
				{
					productId: productJeans.id,
					name: productJeans.name,
					quantity: 1,
					unitPrice: jeansPrice
				},
				{
					productId: productHoodie.id,
					name: productHoodie.name,
					quantity: 1,
					unitPrice: hoodiePrice
				}
			],
			totalAmount: orderLumenTotal,
			catalogId: catalogLumen.id
		}
	})
	const orderNova = await prisma.order.create({
		data: {
			status: 'COMPLETED',
			token: 'order-seed-003',
			comment: 'Office delivery.',
			commentByAdmin: 'Paid online.',
			paymentMethod: 'ACQUIRING',
			paymentProof: [img('payment-proof-2', 800, 600)],
			products: [
				{
					productId: productPhone.id,
					name: productPhone.name,
					quantity: 1,
					unitPrice: phonePrice
				},
				{
					productId: productEarbuds.id,
					name: productEarbuds.name,
					quantity: 1,
					unitPrice: earbudsPrice
				}
			],
			totalAmount: orderNovaTotal,
			catalogId: catalogNova.id
		}
	})

	await prisma.orderItem.createMany({
		data: [
			{
				orderId: orderGreen.id,
				productId: productBurger.id,
				quantity: 2,
				unitPrice: new Prisma.Decimal(burgerPrice)
			},
			{
				orderId: orderGreen.id,
				productId: productSalad.id,
				quantity: 1,
				unitPrice: new Prisma.Decimal(saladPrice)
			},
			{
				orderId: orderGreen.id,
				productId: productWrap.id,
				quantity: 1,
				unitPrice: new Prisma.Decimal(wrapPrice)
			},
			{
				orderId: orderLumen.id,
				productId: productTshirt.id,
				variantId: variantTshirtSW.id,
				quantity: 1,
				unitPrice: new Prisma.Decimal(tshirtPrice)
			},
			{
				orderId: orderLumen.id,
				productId: productJeans.id,
				variantId: variantJeansMB.id,
				quantity: 1,
				unitPrice: new Prisma.Decimal(jeansPrice)
			},
			{
				orderId: orderLumen.id,
				productId: productHoodie.id,
				variantId: variantHoodieMB.id,
				quantity: 1,
				unitPrice: new Prisma.Decimal(hoodiePrice)
			},
			{
				orderId: orderNova.id,
				productId: productPhone.id,
				quantity: 1,
				unitPrice: new Prisma.Decimal(phonePrice)
			},
			{
				orderId: orderNova.id,
				productId: productEarbuds.id,
				quantity: 1,
				unitPrice: new Prisma.Decimal(earbudsPrice)
			}
		]
	})

	const sessionLumen = await prisma.analyticsSession.create({
		data: {
			catalogId: catalogLumen.id,
			userId: shopper.id,
			token: cartLumen.token,
			deviceType: 'MOBILE',
			userAgent: 'SeedAgent/1.0',
			referrer: 'https://google.com',
			landingUrl: `${baseUrl(catalogLumen)}/`,
			utm: {
				source: 'seed',
				medium: 'cpc',
				campaign: 'winter',
				content: 'banner',
				term: 'basic tshirt'
			}
		}
	})
	const sessionGreen = await prisma.analyticsSession.create({
		data: {
			catalogId: catalogGreen.id,
			token: cartGreen.token,
			deviceType: 'DESKTOP',
			userAgent: 'SeedBrowser/2.0',
			referrer: 'https://bing.com',
			landingUrl: `${baseUrl(catalogGreen)}/menu`,
			utm: {
				source: 'social',
				medium: 'instagram',
				campaign: 'fresh-week'
			}
		}
	})
	const sessionNova = await prisma.analyticsSession.create({
		data: {
			catalogId: catalogNova.id,
			userId: shopper2.id,
			token: cartNova.token,
			deviceType: 'TABLET',
			userAgent: 'SeedTablet/1.5',
			referrer: 'https://newsletter.example.com',
			landingUrl: `${baseUrl(catalogNova)}/`,
			utm: {
				source: 'email',
				medium: 'newsletter',
				campaign: 'launch'
			}
		}
	})

	await prisma.analyticsEvent.createMany({
		data: [
			{
				catalogId: catalogLumen.id,
				sessionId: sessionLumen.id,
				userId: shopper.id,
				type: 'PAGE_VIEW',
				pageType: 'HOME',
				url: `${baseUrl(catalogLumen)}/`,
				title: 'Главная',
				perf: { ttfb: 80, lcp: 1400 }
			},
			{
				catalogId: catalogLumen.id,
				sessionId: sessionLumen.id,
				userId: shopper.id,
				type: 'VIEW_PRODUCT',
				pageType: 'PRODUCT',
				url: `${baseUrl(catalogLumen)}/product/${productTshirt.slug}`,
				title: productTshirt.name,
				productId: productTshirt.id,
				categoryId: categoryTshirts.id,
				variantId: variantTshirtSW.id,
				position: 1,
				query: 'tshirt',
				resultsCnt: 1,
				filters: { color: 'white', size: 's' },
				sort: 'popular',
				perf: { ttfb: 120, lcp: 1500 }
			},
			{
				catalogId: catalogLumen.id,
				sessionId: sessionLumen.id,
				userId: shopper.id,
				type: 'ADD_TO_CART',
				pageType: 'PRODUCT',
				url: `${baseUrl(catalogLumen)}/product/${productTshirt.slug}`,
				productId: productTshirt.id,
				variantId: variantTshirtSW.id
			},
			{
				catalogId: catalogGreen.id,
				sessionId: sessionGreen.id,
				type: 'SEARCH_SUBMIT',
				pageType: 'SEARCH',
				url: `${baseUrl(catalogGreen)}/search?query=salad`,
				query: 'salad',
				resultsCnt: 12,
				filters: { vegan: true },
				sort: 'popular'
			},
			{
				catalogId: catalogGreen.id,
				sessionId: sessionGreen.id,
				type: 'VIEW_PRODUCT',
				pageType: 'PRODUCT',
				url: `${baseUrl(catalogGreen)}/product/${productSalad.slug}`,
				title: productSalad.name,
				productId: productSalad.id,
				categoryId: categorySalads.id
			},
			{
				catalogId: catalogNova.id,
				sessionId: sessionNova.id,
				userId: shopper2.id,
				type: 'VIEW_PRODUCT',
				pageType: 'PRODUCT',
				url: `${baseUrl(catalogNova)}/product/${productPhone.slug}`,
				title: productPhone.name,
				productId: productPhone.id,
				categoryId: categoryPhones.id,
				perf: { ttfb: 70, lcp: 1200 }
			},
			{
				catalogId: catalogNova.id,
				sessionId: sessionNova.id,
				userId: shopper2.id,
				type: 'ERROR_API',
				pageType: 'CHECKOUT',
				url: `${baseUrl(catalogNova)}/checkout`,
				statusCode: 500,
				errorName: 'PaymentServiceError',
				errorMsg: 'Payment provider timeout'
			},
			{
				catalogId: catalogNova.id,
				sessionId: sessionNova.id,
				userId: shopper2.id,
				type: 'PERF',
				pageType: 'PRODUCT',
				url: `${baseUrl(catalogNova)}/product/${productPhone.slug}`,
				perf: { ttfb: 60, lcp: 1100, cls: 0.01, inp: 110 }
			}
		]
	})

	await prisma.lead.createMany({
		data: [
			{
				catalogId: catalogLumen.id,
				sessionId: sessionLumen.id,
				userId: shopper.id,
				channel: 'FORM',
				status: 'SUBMITTED',
				productId: productTshirt.id,
				categoryId: categoryTshirts.id,
				name: 'Иван Иванов',
				phone: '+1 555 030 0003',
				email: 'john@example.com',
				message: 'Интересует размер M.',
				meta: { source: 'product_page' }
			},
			{
				catalogId: catalogGreen.id,
				sessionId: sessionGreen.id,
				channel: 'PHONE',
				status: 'QUALIFIED',
				productId: productBurger.id,
				categoryId: categoryBurgers.id,
				name: 'Алексей Грин',
				phone: '+1 555 030 0004',
				message: 'Нужен заказ кейтеринга.',
				qualifiedAt: new Date('2026-01-30T12:00:00.000Z'),
				meta: { source: 'call_center' }
			},
			{
				catalogId: catalogNova.id,
				sessionId: sessionNova.id,
				userId: shopper2.id,
				channel: 'EMAIL',
				status: 'DISQUALIFIED',
				productId: productPhone.id,
				categoryId: categoryPhones.id,
				name: 'Сэм Тех',
				email: 'sam@example.com',
				message: 'Вопрос по доставке.',
				meta: { source: 'support' }
			}
		]
	})

	const reportDate1 = new Date('2026-01-30T00:00:00.000Z')
	const reportDate2 = new Date('2026-01-31T00:00:00.000Z')
	const reportDate3 = new Date('2026-02-01T00:00:00.000Z')
	await prisma.metrikaDailyStat.createMany({
		data: [
			{
				catalogId: catalogLumen.id,
				counterId: '104676804',
				date: reportDate2,
				visits: 120,
				users: 90,
				pageviews: 260,
				bounceRate: 0.35,
				avgVisitDurationSec: 180
			},
			{
				catalogId: catalogLumen.id,
				counterId: '104676804',
				date: reportDate3,
				visits: 130,
				users: 96,
				pageviews: 280,
				bounceRate: 0.32,
				avgVisitDurationSec: 190
			},
			{
				catalogId: catalogGreen.id,
				counterId: '204676805',
				date: reportDate2,
				visits: 140,
				users: 105,
				pageviews: 320,
				bounceRate: 0.28,
				avgVisitDurationSec: 210
			},
			{
				catalogId: catalogUrban.id,
				counterId: '204676806',
				date: reportDate3,
				visits: 95,
				users: 70,
				pageviews: 210,
				bounceRate: 0.31,
				avgVisitDurationSec: 160
			},
			{
				catalogId: catalogNova.id,
				counterId: '304676806',
				date: reportDate2,
				visits: 80,
				users: 60,
				pageviews: 190,
				bounceRate: 0.42,
				avgVisitDurationSec: 150
			},
			{
				catalogId: catalogGlow.id,
				counterId: '404676807',
				date: reportDate1,
				visits: 65,
				users: 50,
				pageviews: 140,
				bounceRate: 0.39,
				avgVisitDurationSec: 170
			}
		]
	})
	await prisma.metrikaSourceDailyStat.createMany({
		data: [
			{
				catalogId: catalogLumen.id,
				date: reportDate2,
				source: 'google',
				medium: 'cpc',
				campaign: 'winter-collection',
				visits: 50,
				users: 40
			},
			{
				catalogId: catalogLumen.id,
				date: reportDate2,
				source: 'direct',
				medium: 'none',
				campaign: 'brand',
				visits: 30,
				users: 25
			},
			{
				catalogId: catalogGreen.id,
				date: reportDate2,
				source: 'instagram',
				medium: 'social',
				campaign: 'fresh-week',
				visits: 45,
				users: 35
			},
			{
				catalogId: catalogNova.id,
				date: reportDate2,
				source: 'newsletter',
				medium: 'email',
				campaign: 'launch',
				visits: 25,
				users: 20
			},
			{
				catalogId: catalogGlow.id,
				date: reportDate1,
				source: 'youtube',
				medium: 'video',
				campaign: 'skincare',
				visits: 18,
				users: 14
			},
			{
				catalogId: catalogUrban.id,
				date: reportDate3,
				source: 'maps',
				medium: 'local',
				campaign: 'brunch',
				visits: 22,
				users: 18
			}
		]
	})

	await prisma.seoSetting.createMany({
		data: [
			{
				catalogId: catalogLumen.id,
				entityType: 'CATALOG',
				entityId: catalogLumen.id,
				urlPath: '/',
				canonicalUrl: `${baseUrl(catalogLumen)}/`,
				title: 'Lumen Одежда',
				description: 'Современные базовые вещи на каждый день.',
				keywords: 'футболки, джинсы, база',
				h1: 'Lumen Одежда',
				seoText: 'Выбирайте базовые вещи и сезонные коллекции.',
				robots: 'index,follow',
				ogTitle: 'Lumen Одежда',
				ogDescription: 'Современные базовые вещи на каждый день.',
				ogImage: img('lumen-og', 1200, 630),
				ogType: 'website',
				ogUrl: `${baseUrl(catalogLumen)}/`,
				ogSiteName: 'Lumen Одежда',
				ogLocale: 'ru_RU',
				twitterCard: 'summary_large_image',
				twitterTitle: 'Lumen Одежда',
				twitterDescription: 'Современные базовые вещи на каждый день.',
				twitterImage: img('lumen-twitter', 1200, 630),
				twitterSite: '@lumen',
				twitterCreator: '@lumen',
				hreflang: { ru: `${baseUrl(catalogLumen)}/` },
				structuredData: {
					'@context': 'https://schema.org',
					'@type': 'Store',
					name: 'Lumen Одежда'
				},
				extras: { seed: true },
				sitemapPriority: 0.8,
				sitemapChangeFreq: 'WEEKLY'
			},
			{
				catalogId: catalogLumen.id,
				entityType: 'CATEGORY',
				entityId: categoryTshirts.id,
				urlPath: '/category/t-shirts',
				canonicalUrl: `${baseUrl(catalogLumen)}/category/t-shirts`,
				title: 'Футболки',
				description: 'Футболки и базовые вещи на каждый день.',
				keywords: 'футболки, база',
				h1: 'Футболки',
				seoText: 'Найдите футболку на каждый день.',
				robots: 'index,follow',
				ogTitle: 'Футболки',
				ogDescription: 'Футболки и базовые вещи на каждый день.',
				ogImage: img('tshirts-og', 1200, 630),
				ogType: 'website',
				ogUrl: `${baseUrl(catalogLumen)}/category/t-shirts`,
				ogSiteName: 'Lumen Одежда',
				ogLocale: 'ru_RU',
				twitterCard: 'summary_large_image',
				twitterTitle: 'Футболки',
				twitterDescription: 'Футболки и базовые вещи на каждый день.',
				twitterImage: img('tshirts-twitter', 1200, 630),
				twitterSite: '@lumen',
				twitterCreator: '@lumen',
				hreflang: { ru: `${baseUrl(catalogLumen)}/category/t-shirts` },
				structuredData: {
					'@context': 'https://schema.org',
					'@type': 'CollectionPage',
					name: 'Футболки'
				},
				extras: { seed: true },
				sitemapPriority: 0.6,
				sitemapChangeFreq: 'WEEKLY'
			},
			{
				catalogId: catalogLumen.id,
				entityType: 'PRODUCT',
				entityId: productTshirt.id,
				urlPath: `/product/${productTshirt.slug}`,
				canonicalUrl: `${baseUrl(catalogLumen)}/product/${productTshirt.slug}`,
				title: productTshirt.name,
				description: 'Мягкая хлопковая футболка в классических цветах.',
				keywords: 'футболка, хлопок, база',
				h1: productTshirt.name,
				seoText: 'Мягкая хлопковая футболка на каждый день.',
				robots: 'index,follow',
				ogTitle: productTshirt.name,
				ogDescription: 'Мягкая хлопковая футболка в классических цветах.',
				ogImage: img('tshirt-og', 1200, 630),
				ogType: 'product',
				ogUrl: `${baseUrl(catalogLumen)}/product/${productTshirt.slug}`,
				ogSiteName: 'Lumen Одежда',
				ogLocale: 'ru_RU',
				twitterCard: 'summary_large_image',
				twitterTitle: productTshirt.name,
				twitterDescription: 'Мягкая хлопковая футболка в классических цветах.',
				twitterImage: img('tshirt-twitter', 1200, 630),
				twitterSite: '@lumen',
				twitterCreator: '@lumen',
				hreflang: {
					en: `${baseUrl(catalogLumen)}/product/${productTshirt.slug}`
				},
				structuredData: {
					'@context': 'https://schema.org',
					'@type': 'Product',
					name: productTshirt.name
				},
				extras: { seed: true },
				sitemapPriority: 0.7,
				sitemapChangeFreq: 'WEEKLY'
			},
			{
				catalogId: catalogLumenOutlet.id,
				entityType: 'CATALOG',
				entityId: catalogLumenOutlet.id,
				urlPath: '/',
				canonicalUrl: `${baseUrl(catalogLumenOutlet)}/`,
				title: 'Lumen Аутлет',
				description: 'Товары прошлых сезонов и ограниченные остатки.',
				keywords: 'аутлет, распродажа, мода',
				h1: 'Lumen Аутлет',
				seoText: 'Покупайте аутлет и ограниченные остатки.',
				robots: 'index,follow',
				ogTitle: 'Lumen Аутлет',
				ogDescription: 'Товары прошлых сезонов и ограниченные остатки.',
				ogImage: img('lumen-outlet-og', 1200, 630),
				ogType: 'website',
				ogUrl: `${baseUrl(catalogLumenOutlet)}/`,
				ogSiteName: 'Lumen Аутлет',
				ogLocale: 'ru_RU',
				twitterCard: 'summary_large_image',
				twitterTitle: 'Lumen Аутлет',
				twitterDescription: 'Товары прошлых сезонов и ограниченные остатки.',
				twitterImage: img('lumen-outlet-twitter', 1200, 630),
				twitterSite: '@lumen',
				twitterCreator: '@lumen',
				extras: { seed: true },
				sitemapPriority: 0.5,
				sitemapChangeFreq: 'WEEKLY'
			},
			{
				catalogId: catalogGreen.id,
				entityType: 'CATALOG',
				entityId: catalogGreen.id,
				urlPath: '/',
				canonicalUrl: `${baseUrl(catalogGreen)}/`,
				title: 'Грин Спун',
				description: 'Свежая еда каждый день.',
				keywords: 'бургеры, салаты, кафе',
				h1: 'Грин Спун',
				seoText: 'Свежая еда каждый день.',
				robots: 'index,follow',
				ogTitle: 'Грин Спун',
				ogDescription: 'Свежая еда каждый день.',
				ogImage: img('greenspoon-og', 1200, 630),
				ogType: 'website',
				ogUrl: `${baseUrl(catalogGreen)}/`,
				ogSiteName: 'Грин Спун',
				ogLocale: 'ru_RU',
				twitterCard: 'summary_large_image',
				twitterTitle: 'Грин Спун',
				twitterDescription: 'Свежая еда каждый день.',
				twitterImage: img('greenspoon-twitter', 1200, 630),
				twitterSite: '@greenspoon',
				twitterCreator: '@greenspoon',
				extras: { seed: true },
				sitemapPriority: 0.7,
				sitemapChangeFreq: 'WEEKLY'
			},
			{
				catalogId: catalogGreen.id,
				entityType: 'CATEGORY',
				entityId: categoryBurgers.id,
				urlPath: '/category/burgers',
				canonicalUrl: `${baseUrl(catalogGreen)}/category/burgers`,
				title: 'Бургеры',
				description: 'Классические и фирменные бургеры.',
				keywords: 'бургеры, гриль',
				h1: 'Бургеры',
				seoText: 'Выберите бургер из нашей подборки.',
				robots: 'index,follow',
				ogTitle: 'Бургеры',
				ogDescription: 'Классические и фирменные бургеры.',
				ogImage: img('burgers-og', 1200, 630),
				ogType: 'website',
				ogUrl: `${baseUrl(catalogGreen)}/category/burgers`,
				ogSiteName: 'Грин Спун',
				ogLocale: 'ru_RU',
				twitterCard: 'summary_large_image',
				twitterTitle: 'Бургеры',
				twitterDescription: 'Классические и фирменные бургеры.',
				twitterImage: img('burgers-twitter', 1200, 630),
				twitterSite: '@greenspoon',
				twitterCreator: '@greenspoon',
				extras: { seed: true },
				sitemapPriority: 0.6,
				sitemapChangeFreq: 'WEEKLY'
			},
			{
				catalogId: catalogGreen.id,
				entityType: 'PRODUCT',
				entityId: productBurger.id,
				urlPath: `/product/${productBurger.slug}`,
				canonicalUrl: `${baseUrl(catalogGreen)}/product/${productBurger.slug}`,
				title: productBurger.name,
				description: 'Сочный бургер со свежими ингредиентами.',
				keywords: 'бургер, гриль',
				h1: productBurger.name,
				seoText: 'Сочный бургер со свежими ингредиентами.',
				robots: 'index,follow',
				ogTitle: productBurger.name,
				ogDescription: 'Сочный бургер со свежими ингредиентами.',
				ogImage: img('burger-og', 1200, 630),
				ogType: 'product',
				ogUrl: `${baseUrl(catalogGreen)}/product/${productBurger.slug}`,
				ogSiteName: 'Грин Спун',
				ogLocale: 'ru_RU',
				twitterCard: 'summary_large_image',
				twitterTitle: productBurger.name,
				twitterDescription: 'Сочный бургер со свежими ингредиентами.',
				twitterImage: img('burger-twitter', 1200, 630),
				twitterSite: '@greenspoon',
				twitterCreator: '@greenspoon',
				extras: { seed: true },
				sitemapPriority: 0.7,
				sitemapChangeFreq: 'WEEKLY'
			},
			{
				catalogId: catalogUrban.id,
				entityType: 'CATALOG',
				entityId: catalogUrban.id,
				urlPath: '/',
				canonicalUrl: `${baseUrl(catalogUrban)}/`,
				title: 'Урбан Кафе',
				description: 'Кофе и выпечка в центре города.',
				h1: 'Урбан Кафе',
				robots: 'index,follow',
				ogTitle: 'Урбан Кафе',
				ogDescription: 'Кофе и выпечка в центре города.',
				ogImage: img('urban-og', 1200, 630),
				ogType: 'website',
				ogUrl: `${baseUrl(catalogUrban)}/`,
				ogSiteName: 'Урбан Кафе',
				ogLocale: 'ru_RU',
				twitterCard: 'summary_large_image',
				twitterTitle: 'Урбан Кафе',
				twitterDescription: 'Кофе и выпечка в центре города.',
				twitterImage: img('urban-twitter', 1200, 630),
				extras: { seed: true },
				sitemapPriority: 0.6,
				sitemapChangeFreq: 'WEEKLY'
			},
			{
				catalogId: catalogNova.id,
				entityType: 'CATALOG',
				entityId: catalogNova.id,
				urlPath: '/',
				canonicalUrl: `${baseUrl(catalogNova)}/`,
				title: 'Нова Тех',
				description: 'Устройства и аксессуары для повседневной жизни.',
				keywords: 'телефоны, ноутбуки, гаджеты',
				h1: 'Нова Тех',
				robots: 'index,follow',
				ogTitle: 'Нова Тех',
				ogDescription: 'Устройства и аксессуары для повседневной жизни.',
				ogImage: img('novatech-og', 1200, 630),
				ogType: 'website',
				ogUrl: `${baseUrl(catalogNova)}/`,
				ogSiteName: 'Нова Тех',
				ogLocale: 'ru_RU',
				twitterCard: 'summary_large_image',
				twitterTitle: 'Нова Тех',
				twitterDescription: 'Устройства и аксессуары для повседневной жизни.',
				twitterImage: img('novatech-twitter', 1200, 630),
				twitterSite: '@novatech',
				twitterCreator: '@novatech',
				extras: { seed: true },
				sitemapPriority: 0.7,
				sitemapChangeFreq: 'WEEKLY'
			},
			{
				catalogId: catalogNova.id,
				entityType: 'CATEGORY',
				entityId: categoryPhones.id,
				urlPath: '/category/phones',
				canonicalUrl: `${baseUrl(catalogNova)}/category/phones`,
				title: 'Телефоны',
				description: 'Смартфоны и аксессуары.',
				keywords: 'телефоны, смартфоны',
				h1: 'Телефоны',
				seoText: 'Познакомьтесь с нашей линейкой смартфонов.',
				robots: 'index,follow',
				ogTitle: 'Телефоны',
				ogDescription: 'Смартфоны и аксессуары.',
				ogImage: img('phones-og', 1200, 630),
				ogType: 'website',
				ogUrl: `${baseUrl(catalogNova)}/category/phones`,
				ogSiteName: 'Нова Тех',
				ogLocale: 'ru_RU',
				twitterCard: 'summary_large_image',
				twitterTitle: 'Телефоны',
				twitterDescription: 'Смартфоны и аксессуары.',
				twitterImage: img('phones-twitter', 1200, 630),
				twitterSite: '@novatech',
				twitterCreator: '@novatech',
				extras: { seed: true },
				sitemapPriority: 0.6,
				sitemapChangeFreq: 'WEEKLY'
			},
			{
				catalogId: catalogNova.id,
				entityType: 'PRODUCT',
				entityId: productPhone.id,
				urlPath: `/product/${productPhone.slug}`,
				canonicalUrl: `${baseUrl(catalogNova)}/product/${productPhone.slug}`,
				title: productPhone.name,
				description: 'Флагманский смартфон с впечатляющим экраном.',
				keywords: 'телефон, смартфон',
				h1: productPhone.name,
				seoText: 'Флагманский смартфон с впечатляющим экраном.',
				robots: 'index,follow',
				ogTitle: productPhone.name,
				ogDescription: 'Флагманский смартфон с впечатляющим экраном.',
				ogImage: img('phone-og', 1200, 630),
				ogType: 'product',
				ogUrl: `${baseUrl(catalogNova)}/product/${productPhone.slug}`,
				ogSiteName: 'Нова Тех',
				ogLocale: 'ru_RU',
				twitterCard: 'summary_large_image',
				twitterTitle: productPhone.name,
				twitterDescription: 'Флагманский смартфон с впечатляющим экраном.',
				twitterImage: img('phone-twitter', 1200, 630),
				twitterSite: '@novatech',
				twitterCreator: '@novatech',
				extras: { seed: true },
				sitemapPriority: 0.7,
				sitemapChangeFreq: 'WEEKLY'
			},
			{
				catalogId: catalogGlow.id,
				entityType: 'CATALOG',
				entityId: catalogGlow.id,
				urlPath: '/',
				canonicalUrl: `${baseUrl(catalogGlow)}/`,
				title: 'Глоу Бьюти',
				description: 'Базовый уход и ежедневные ритуалы.',
				keywords: 'уход, красота',
				h1: 'Глоу Бьюти',
				robots: 'index,follow',
				ogTitle: 'Глоу Бьюти',
				ogDescription: 'Базовый уход и ежедневные ритуалы.',
				ogImage: img('glow-og', 1200, 630),
				ogType: 'website',
				ogUrl: `${baseUrl(catalogGlow)}/`,
				ogSiteName: 'Глоу Бьюти',
				ogLocale: 'ru_RU',
				twitterCard: 'summary_large_image',
				twitterTitle: 'Глоу Бьюти',
				twitterDescription: 'Базовый уход и ежедневные ритуалы.',
				twitterImage: img('glow-twitter', 1200, 630),
				twitterSite: '@glowbeauty',
				twitterCreator: '@glowbeauty',
				extras: { seed: true },
				sitemapPriority: 0.7,
				sitemapChangeFreq: 'WEEKLY'
			},
			{
				catalogId: catalogGlow.id,
				entityType: 'CATEGORY',
				entityId: categorySkincare.id,
				urlPath: '/category/skincare',
				canonicalUrl: `${baseUrl(catalogGlow)}/category/skincare`,
				title: 'Уход за кожей',
				description: 'Базовый уход для ежедневных процедур.',
				keywords: 'уход, процедуры',
				h1: 'Уход за кожей',
				seoText: 'Базовый уход для ежедневных процедур.',
				robots: 'index,follow',
				ogTitle: 'Уход за кожей',
				ogDescription: 'Базовый уход для ежедневных процедур.',
				ogImage: img('skincare-og', 1200, 630),
				ogType: 'website',
				ogUrl: `${baseUrl(catalogGlow)}/category/skincare`,
				ogSiteName: 'Глоу Бьюти',
				ogLocale: 'ru_RU',
				twitterCard: 'summary_large_image',
				twitterTitle: 'Уход за кожей',
				twitterDescription: 'Базовый уход для ежедневных процедур.',
				twitterImage: img('skincare-twitter', 1200, 630),
				twitterSite: '@glowbeauty',
				twitterCreator: '@glowbeauty',
				extras: { seed: true },
				sitemapPriority: 0.6,
				sitemapChangeFreq: 'WEEKLY'
			},
			{
				catalogId: catalogGlow.id,
				entityType: 'PRODUCT',
				entityId: productSerum.id,
				urlPath: `/product/${productSerum.slug}`,
				canonicalUrl: `${baseUrl(catalogGlow)}/product/${productSerum.slug}`,
				title: productSerum.name,
				description: 'Увлажняющая сыворотка для ежедневного использования.',
				keywords: 'сыворотка, уход',
				h1: productSerum.name,
				seoText: 'Увлажняющая сыворотка для ежедневного использования.',
				robots: 'index,follow',
				ogTitle: productSerum.name,
				ogDescription: 'Увлажняющая сыворотка для ежедневного использования.',
				ogImage: img('serum-og', 1200, 630),
				ogType: 'product',
				ogUrl: `${baseUrl(catalogGlow)}/product/${productSerum.slug}`,
				ogSiteName: 'Глоу Бьюти',
				ogLocale: 'ru_RU',
				twitterCard: 'summary_large_image',
				twitterTitle: productSerum.name,
				twitterDescription: 'Увлажняющая сыворотка для ежедневного использования.',
				twitterImage: img('serum-twitter', 1200, 630),
				twitterSite: '@glowbeauty',
				twitterCreator: '@glowbeauty',
				extras: { seed: true },
				sitemapPriority: 0.7,
				sitemapChangeFreq: 'WEEKLY'
			}
		]
	})

	const [categories, products, configs, seoSettings] = await prisma.$transaction([
		prisma.category.findMany({
			select: { catalogId: true, imageUrl: true }
		}),
		prisma.product.findMany({
			select: { catalogId: true, imagesUrls: true }
		}),
		prisma.catalogConfig.findMany({
			select: { catalogId: true, logoUrl: true, bgUrl: true }
		}),
		prisma.seoSetting.findMany({
			select: { catalogId: true, ogImage: true, twitterImage: true }
		})
	])

	const mediaUrlsByCatalog = new Map<string, Set<string>>()

	for (const category of categories) {
		addMediaUrl(mediaUrlsByCatalog, category.catalogId, category.imageUrl)
	}
	for (const product of products) {
		for (const url of product.imagesUrls ?? []) {
			addMediaUrl(mediaUrlsByCatalog, product.catalogId, url)
		}
	}
	for (const config of configs) {
		addMediaUrl(mediaUrlsByCatalog, config.catalogId, config.logoUrl)
		addMediaUrl(mediaUrlsByCatalog, config.catalogId, config.bgUrl)
	}
	for (const seo of seoSettings) {
		addMediaUrl(mediaUrlsByCatalog, seo.catalogId, seo.ogImage)
		addMediaUrl(mediaUrlsByCatalog, seo.catalogId, seo.twitterImage)
	}

	const mediaTasks: Promise<Prisma.BatchPayload>[] = []
	for (const [catalogId, urls] of mediaUrlsByCatalog) {
		const data: Prisma.MediaCreateManyInput[] = Array.from(urls).map(url => {
			const mimeType = guessMediaMime(url)
			return {
				catalogId,
				originalName: buildMediaOriginalName(url, mimeType),
				mimeType,
				storage: 'url',
				key: url,
				status: 'READY'
			}
		})
		if (data.length) {
			mediaTasks.push(prisma.media.createMany({ data, skipDuplicates: true }))
		}
	}
	await Promise.all(mediaTasks)

	console.log('Seed completed:', {
		users: [
			admin.login,
			catalogUserLumen.login,
			catalogUserLumenOutlet.login,
			catalogUserGreen.login,
			catalogUserUrban.login,
			catalogUserNova.login,
			catalogUserGlow.login,
			shopper.login,
			shopper2.login
		],
		catalogs: [
			catalogLumen.slug,
			catalogLumenOutlet.slug,
			catalogGreen.slug,
			catalogUrban.slug,
			catalogNova.slug,
			catalogGlow.slug
		]
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



