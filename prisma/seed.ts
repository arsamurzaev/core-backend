import { PrismaPg } from '@prisma/adapter-pg'
import { hash } from 'argon2'
import 'dotenv/config'

import {
	CatalogStatus,
	DataType,
	MediaStatus,
	Prisma,
	PrismaClient,
	ProductStatus,
	ProductVariantStatus,
	Role,
	SeoEntityType
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
	businessId?: string | null
}

type AttributeSeed = {
	key: string
	displayName: string
	dataType: DataType
	isRequired: boolean
	isVariantAttribute: boolean
	isFilterable: boolean
	displayOrder: number
	isHidden?: boolean
	enumValues?: EnumValueSeed[]
}

type CatalogTypeSeed = {
	code: string
	name: string
	uniqueAttribute: AttributeSeed
	variantAttribute: AttributeSeed
}

type CategorySeed = {
	slug: string
	name: string
	position: number
	descriptor?: string
	discount?: number
	imageUrl: string
}

type ProductSeed = {
	sku: string
	name: string
	slug: string
	categorySlug: string
	price: string
	brandValue: string
	subtitle: string
	about: string
	description: string
	uniqueValue: string | number | boolean | Date | Prisma.Decimal
	mediaUrls: string[]
	discountPercent?: number
	isPopular?: boolean
}

type CatalogSeed = {
	typeCode: string
	slug: string
	domain: string
	name: string
	about: string
	description: string
	currency: string
	logoUrl: string
	bgUrl: string
	categories: CategorySeed[]
	products: ProductSeed[]
}

type TypeContext = {
	typeId: string
	typeName: string
	uniqueAttributeId: string
	uniqueAttributeDataType: DataType
	variantAttributeId: string
	variantAttributeKey: string
	variantEnumValues: { id: string; value: string }[]
}

const commonProductAttributes: AttributeSeed[] = [
	{
		key: 'brand',
		displayName: 'Brand',
		dataType: DataType.ENUM,
		isRequired: true,
		isVariantAttribute: false,
		isFilterable: true,
		displayOrder: 80
	},
	{
		key: 'subtitle',
		displayName: 'Subtitle',
		dataType: DataType.STRING,
		isRequired: false,
		isVariantAttribute: false,
		isFilterable: false,
		displayOrder: 81,
		isHidden: true
	},
	{
		key: 'about',
		displayName: 'About',
		dataType: DataType.STRING,
		isRequired: false,
		isVariantAttribute: false,
		isFilterable: false,
		displayOrder: 82,
		isHidden: true
	},
	{
		key: 'description',
		displayName: 'Description',
		dataType: DataType.STRING,
		isRequired: false,
		isVariantAttribute: false,
		isFilterable: false,
		displayOrder: 83,
		isHidden: true
	},
	{
		key: 'discount',
		displayName: 'Discount',
		dataType: DataType.INTEGER,
		isRequired: false,
		isVariantAttribute: false,
		isFilterable: false,
		displayOrder: 84,
		isHidden: true
	},
	{
		key: 'discountedPrice',
		displayName: 'Discounted price',
		dataType: DataType.DECIMAL,
		isRequired: false,
		isVariantAttribute: false,
		isFilterable: false,
		displayOrder: 85,
		isHidden: true
	},
	{
		key: 'discountStartAt',
		displayName: 'Discount starts at',
		dataType: DataType.DATETIME,
		isRequired: false,
		isVariantAttribute: false,
		isFilterable: false,
		displayOrder: 86,
		isHidden: true
	},
	{
		key: 'discountEndAt',
		displayName: 'Discount ends at',
		dataType: DataType.DATETIME,
		isRequired: false,
		isVariantAttribute: false,
		isFilterable: false,
		displayOrder: 87,
		isHidden: true
	}
]

const catalogTypeSeeds: CatalogTypeSeed[] = [
	{
		code: 'restaurant',
		name: 'Restaurants',
		uniqueAttribute: {
			key: 'restaurant_cuisine',
			displayName: 'Cuisine',
			dataType: DataType.STRING,
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 1
		},
		variantAttribute: {
			key: 'restaurant_portion_size',
			displayName: 'Portion size',
			dataType: DataType.ENUM,
			isRequired: true,
			isVariantAttribute: true,
			isFilterable: true,
			displayOrder: 2,
			enumValues: [
				{ value: 'small', displayName: 'Small' },
				{ value: 'regular', displayName: 'Regular' },
				{ value: 'family', displayName: 'Family' }
			]
		}
	},
	{
		code: 'clothing',
		name: 'Clothing',
		uniqueAttribute: {
			key: 'clothing_material',
			displayName: 'Material',
			dataType: DataType.STRING,
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 1
		},
		variantAttribute: {
			key: 'clothing_size',
			displayName: 'Size',
			dataType: DataType.ENUM,
			isRequired: true,
			isVariantAttribute: true,
			isFilterable: true,
			displayOrder: 2,
			enumValues: [
				{ value: 's', displayName: 'S' },
				{ value: 'm', displayName: 'M' },
				{ value: 'l', displayName: 'L' },
				{ value: 'xl', displayName: 'XL' }
			]
		}
	}
]

const brandEnumValues: EnumValueSeed[] = [
	{ value: 'urban-thread', displayName: 'Urban Thread' },
	{ value: 'denim-lab', displayName: 'Denim Lab' },
	{ value: 'city-burger', displayName: 'City Burger' },
	{ value: 'pizza-yard', displayName: 'Pizza Yard' },
	{ value: 'fresh-sip', displayName: 'Fresh Sip' }
]

function buildOpenSourcePhotoUrl(
	seed: string,
	width = 1600,
	height = 1000
): string {
	return `https://picsum.photos/seed/${encodeURIComponent(seed)}/${width}/${height}`
}

function buildMediaGallery(seedPrefix: string, count: number): string[] {
	return Array.from({ length: count }, (_, index) =>
		buildOpenSourcePhotoUrl(`${seedPrefix}-${index + 1}`)
	)
}

function defaultBrandByCategory(typeCode: string, categorySlug: string): string {
	if (typeCode === 'restaurant') {
		if (categorySlug === 'drinks') return 'fresh-sip'
		if (categorySlug === 'pizza') return 'pizza-yard'
		return 'city-burger'
	}

	if (categorySlug === 'jeans' || categorySlug === 'jackets') return 'denim-lab'
	return 'urban-thread'
}

function defaultPrice(typeCode: string, categorySlug: string, order: number): string {
	const restaurantBase: Record<string, number> = {
		burgers: 520,
		pizza: 760,
		drinks: 190
	}
	const clothingBase: Record<string, number> = {
		tshirts: 1190,
		hoodies: 2590,
		jeans: 3390,
		jackets: 4590
	}

	const base =
		typeCode === 'restaurant'
			? (restaurantBase[categorySlug] ?? 500)
			: (clothingBase[categorySlug] ?? 1290)

	return (base + order * 30).toFixed(2)
}

function ensureProductsPerCategory(
	catalogs: CatalogSeed[],
	targetPerCategory: number
): CatalogSeed[] {
	return catalogs.map(catalog => {
		const products = [...catalog.products]
		const existingSlugs = new Set(products.map(product => product.slug))
		const existingSkus = new Set(products.map(product => product.sku))

		for (const category of catalog.categories) {
			let categoryCount = products.filter(
				product => product.categorySlug === category.slug
			).length

			while (categoryCount < targetPerCategory) {
				const nextOrder = categoryCount + 1
				let slug = `${category.slug}-item-${nextOrder}`
				let suffix = nextOrder
				while (existingSlugs.has(slug)) {
					suffix += 1
					slug = `${category.slug}-item-${suffix}`
				}

				const catalogCode = catalog.slug
					.replace(/[^a-z0-9]+/gi, '')
					.slice(0, 6)
					.toUpperCase()
				const categoryCode = category.slug
					.replace(/[^a-z0-9]+/gi, '')
					.slice(0, 3)
					.toUpperCase()
				const skuBase = `${catalogCode}-${categoryCode}-${String(suffix).padStart(3, '0')}`
				let sku = skuBase
				let skuSuffix = 1
				while (existingSkus.has(sku)) {
					sku = `${skuBase}-${skuSuffix}`
					skuSuffix += 1
				}

				const readableCategoryName = category.name.replace(/[^a-zA-Z0-9]+/g, ' ').trim()
				const productName = `${readableCategoryName} Item ${nextOrder}`
				const seedPrefix = `${catalog.typeCode}-${catalog.slug}-${category.slug}-${nextOrder}`

				products.push({
					sku,
					name: productName,
					slug,
					categorySlug: category.slug,
					price: defaultPrice(catalog.typeCode, category.slug, nextOrder),
					brandValue: defaultBrandByCategory(catalog.typeCode, category.slug),
					subtitle: `${productName} for seed data`,
					about: `Auto-generated product for ${category.name} category.`,
					description: `Generated product ${nextOrder} in category ${category.name}.`,
					uniqueValue:
						catalog.typeCode === 'restaurant'
							? `${category.name} cuisine`
							: `${category.name} material`,
					discountPercent: (nextOrder % 3) * 5,
					isPopular: nextOrder % 2 === 0,
					mediaUrls: buildMediaGallery(`${seedPrefix}-media`, 2)
				})

				existingSlugs.add(slug)
				existingSkus.add(sku)
				categoryCount += 1
			}
		}

		return { ...catalog, products }
	})
}

const baseCatalogSeeds: CatalogSeed[] = [
	{
		typeCode: 'restaurant',
		slug: 'city-kitchen',
		domain: 'city-kitchen.catalog.local',
		name: 'City Kitchen',
		about: 'Demo restaurant catalog with burgers, pizza and drinks.',
		description: 'Seed dataset for testing restaurant category and products.',
		currency: 'RUB',
		logoUrl: buildOpenSourcePhotoUrl('restaurant-city-kitchen-logo'),
		bgUrl: buildOpenSourcePhotoUrl('restaurant-city-kitchen-bg'),
		categories: [
			{
				slug: 'burgers',
				name: 'Burgers',
				position: 0,
				descriptor: 'Grilled burgers and combos',
				discount: 8,
				imageUrl: buildOpenSourcePhotoUrl('restaurant-city-kitchen-category-burgers')
			},
			{
				slug: 'pizza',
				name: 'Pizza',
				position: 1,
				descriptor: 'Wood-fired pizza',
				discount: 10,
				imageUrl: buildOpenSourcePhotoUrl('restaurant-city-kitchen-category-pizza')
			},
			{
				slug: 'drinks',
				name: 'Drinks',
				position: 2,
				descriptor: 'Cold beverages',
				imageUrl: buildOpenSourcePhotoUrl('restaurant-city-kitchen-category-drinks')
			}
		],
		products: [
			{
				sku: 'RSTR-BURGER-001',
				name: 'Classic Beef Burger',
				slug: 'classic-beef-burger',
				categorySlug: 'burgers',
				price: '590.00',
				brandValue: 'city-burger',
				subtitle: 'Juicy beef patty with cheddar',
				about: 'Signature burger with fresh vegetables and house sauce.',
				description: 'Classic beef burger with cheddar, pickles and brioche bun.',
				uniqueValue: 'American',
				discountPercent: 5,
				isPopular: true,
				mediaUrls: buildMediaGallery('restaurant-city-kitchen-product-classic-beef-burger', 2)
			},
			{
				sku: 'RSTR-BURGER-002',
				name: 'Chicken Crispy Burger',
				slug: 'chicken-crispy-burger',
				categorySlug: 'burgers',
				price: '540.00',
				brandValue: 'city-burger',
				subtitle: 'Crispy chicken and spicy mayo',
				about: 'Crunchy chicken burger with lettuce and jalapeno sauce.',
				description:
					'Breaded chicken fillet, lettuce, onions and spicy mayo in brioche bun.',
				uniqueValue: 'American',
				discountPercent: 7,
				mediaUrls: buildMediaGallery('restaurant-city-kitchen-product-chicken-crispy-burger', 2)
			},
			{
				sku: 'RSTR-PIZZA-001',
				name: 'Margherita Pizza',
				slug: 'margherita-pizza',
				categorySlug: 'pizza',
				price: '790.00',
				brandValue: 'pizza-yard',
				subtitle: 'Tomato sauce, mozzarella, basil',
				about: 'Classic margherita with soft dough and fresh basil.',
				description: 'Neapolitan-style margherita pizza with mozzarella and basil.',
				uniqueValue: 'Italian',
				discountPercent: 10,
				isPopular: true,
				mediaUrls: buildMediaGallery('restaurant-city-kitchen-product-margherita-pizza', 2)
			},
			{
				sku: 'RSTR-PIZZA-002',
				name: 'Pepperoni Pizza',
				slug: 'pepperoni-pizza',
				categorySlug: 'pizza',
				price: '890.00',
				brandValue: 'pizza-yard',
				subtitle: 'Pepperoni and mozzarella',
				about: 'Spicy pepperoni pizza with extra cheese.',
				description: 'Pepperoni pizza with tomato base and mozzarella cheese.',
				uniqueValue: 'Italian',
				discountPercent: 10,
				mediaUrls: buildMediaGallery('restaurant-city-kitchen-product-pepperoni-pizza', 2)
			},
			{
				sku: 'RSTR-DRINK-001',
				name: 'Citrus Lemonade',
				slug: 'citrus-lemonade',
				categorySlug: 'drinks',
				price: '220.00',
				brandValue: 'fresh-sip',
				subtitle: 'House lemonade',
				about: 'Refreshing citrus lemonade with mint and ice.',
				description: 'Fresh lemonade made with lemon, orange and mint.',
				uniqueValue: 'Beverage',
				discountPercent: 0,
				mediaUrls: buildMediaGallery('restaurant-city-kitchen-product-citrus-lemonade', 2)
			}
		]
	},
	{
		typeCode: 'clothing',
		slug: 'urban-style',
		domain: 'urban-style.catalog.local',
		name: 'Urban Style',
		about: 'Demo clothing catalog for t-shirts, hoodies, jeans and jackets.',
		description: 'Seed dataset for clothing categories and product pages.',
		currency: 'RUB',
		logoUrl: buildOpenSourcePhotoUrl('clothing-urban-style-logo'),
		bgUrl: buildOpenSourcePhotoUrl('clothing-urban-style-bg'),
		categories: [
			{
				slug: 'tshirts',
				name: 'T-Shirts',
				position: 0,
				descriptor: 'Everyday cotton basics',
				discount: 12,
				imageUrl: buildOpenSourcePhotoUrl('clothing-urban-style-category-tshirts')
			},
			{
				slug: 'hoodies',
				name: 'Hoodies',
				position: 1,
				descriptor: 'Oversized and warm',
				discount: 10,
				imageUrl: buildOpenSourcePhotoUrl('clothing-urban-style-category-hoodies')
			},
			{
				slug: 'jeans',
				name: 'Jeans',
				position: 2,
				descriptor: 'Classic denim fits',
				imageUrl: buildOpenSourcePhotoUrl('clothing-urban-style-category-jeans')
			},
			{
				slug: 'jackets',
				name: 'Jackets',
				position: 3,
				descriptor: 'Outerwear and layers',
				imageUrl: buildOpenSourcePhotoUrl('clothing-urban-style-category-jackets')
			}
		],
		products: [
			{
				sku: 'CLTH-TSHIRT-001',
				name: 'Basic Cotton Tee',
				slug: 'basic-cotton-tee',
				categorySlug: 'tshirts',
				price: '1290.00',
				brandValue: 'urban-thread',
				subtitle: 'Soft cotton everyday t-shirt',
				about: 'A minimalist t-shirt for daily wear.',
				description: 'Regular fit t-shirt made from breathable cotton fabric.',
				uniqueValue: '100% cotton',
				discountPercent: 15,
				isPopular: true,
				mediaUrls: buildMediaGallery('clothing-urban-style-product-basic-cotton-tee', 2)
			},
			{
				sku: 'CLTH-HOODIE-001',
				name: 'Oversized Hoodie',
				slug: 'oversized-hoodie',
				categorySlug: 'hoodies',
				price: '2890.00',
				brandValue: 'urban-thread',
				subtitle: 'Relaxed fit hoodie',
				about: 'Warm hoodie with brushed inner layer and kangaroo pocket.',
				description: 'Oversized hoodie designed for casual streetwear looks.',
				uniqueValue: 'Cotton fleece',
				discountPercent: 10,
				mediaUrls: buildMediaGallery('clothing-urban-style-product-oversized-hoodie', 2)
			},
			{
				sku: 'CLTH-JEANS-001',
				name: 'Slim Fit Jeans',
				slug: 'slim-fit-jeans',
				categorySlug: 'jeans',
				price: '3590.00',
				brandValue: 'denim-lab',
				subtitle: 'Stretch denim',
				about: 'Comfortable slim fit jeans for daily use.',
				description: 'Mid-rise slim jeans made from durable stretch denim.',
				uniqueValue: 'Denim',
				discountPercent: 12,
				mediaUrls: buildMediaGallery('clothing-urban-style-product-slim-fit-jeans', 2)
			},
			{
				sku: 'CLTH-JACKET-001',
				name: 'City Bomber Jacket',
				slug: 'city-bomber-jacket',
				categorySlug: 'jackets',
				price: '4990.00',
				brandValue: 'denim-lab',
				subtitle: 'Lightweight jacket',
				about: 'Bomber jacket for spring and autumn weather.',
				description: 'Street-style bomber jacket with zip front and rib cuffs.',
				uniqueValue: 'Polyester blend',
				discountPercent: 20,
				mediaUrls: buildMediaGallery('clothing-urban-style-product-city-bomber-jacket', 2)
			}
		]
	}
]

const catalogSeeds: CatalogSeed[] = ensureProductsPerCategory(baseCatalogSeeds, 4)

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

function resolveMimeType(sourceUrl: string): string {
	const value = sourceUrl.toLowerCase()
	if (value.endsWith('.png')) return 'image/png'
	if (value.endsWith('.webp')) return 'image/webp'
	if (value.endsWith('.svg')) return 'image/svg+xml'
	return 'image/jpeg'
}

function resolveOriginalName(sourceUrl: string): string {
	try {
		const pathname = new URL(sourceUrl).pathname
		const baseName = pathname.split('/').pop()
		if (!baseName) return 'seed-image.jpg'
		return decodeURIComponent(baseName)
	} catch {
		return 'seed-image.jpg'
	}
}

async function getOrCreateMedia(
	catalogId: string,
	sourceUrl: string,
	cache: Map<string, string>
) {
	const cacheKey = `${catalogId}:${sourceUrl}`
	const cached = cache.get(cacheKey)
	if (cached) {
		return cached
	}

	const media = await prisma.media.create({
		data: {
			catalogId,
			originalName: resolveOriginalName(sourceUrl),
			mimeType: resolveMimeType(sourceUrl),
			storage: 'url',
			key: sourceUrl,
			path: sourceUrl,
			status: MediaStatus.READY
		}
	})

	cache.set(cacheKey, media.id)
	return media.id
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
					isHidden: attribute.isHidden ?? false,
					types: {
						connect: typeIds.map(id => ({ id }))
					}
				}
			})
		)
	)

	return Object.fromEntries(
		created.map(attribute => [attribute.key, attribute])
	) as Record<string, (typeof created)[number]>
}

async function createTypedProductAttribute(
	productId: string,
	attributeId: string,
	dataType: DataType,
	value: string | number | boolean | Date | Prisma.Decimal
) {
	const data: Prisma.ProductAttributeUncheckedCreateInput = {
		productId,
		attributeId
	}

	switch (dataType) {
		case DataType.INTEGER:
			data.valueInteger =
				typeof value === 'number'
					? Math.trunc(value)
					: Number.parseInt(String(value), 10)
			break
		case DataType.BOOLEAN:
			data.valueBoolean =
				typeof value === 'boolean' ? value : String(value) === 'true'
			break
		case DataType.DECIMAL:
			data.valueDecimal =
				value instanceof Prisma.Decimal
					? value
					: new Prisma.Decimal(typeof value === 'number' ? value : String(value))
			break
		case DataType.DATETIME:
			data.valueDateTime = value instanceof Date ? value : new Date(String(value))
			break
		case DataType.ENUM:
			throw new Error(
				`Enum value for attribute ${attributeId} should be handled via enumValueId`
			)
		case DataType.STRING:
		default:
			data.valueString = String(value)
			break
	}

	return prisma.productAttribute.create({ data })
}

async function main() {
	await clearDatabase()

	const passwordHash = await hash('password')

	const defaultRegion = await prisma.regionality.create({
		data: { code: 'RU-MOW', name: 'Moscow' }
	})

	const admin = await prisma.user.create({
		data: {
			name: 'Administrator',
			login: 'admin',
			password: passwordHash,
			role: Role.ADMIN,
			isEmailConfirmed: true,
			regions: { connect: [{ id: defaultRegion.id }] }
		}
	})

	const catalogOwner = await prisma.user.create({
		data: {
			name: 'Catalog Owner',
			login: 'catalog-owner',
			password: passwordHash,
			role: Role.CATALOG,
			isEmailConfirmed: true,
			regions: { connect: [{ id: defaultRegion.id }] }
		}
	})

	const activity = await prisma.activity.create({
		data: { name: 'Online catalog' }
	})

	const types = await Promise.all(
		catalogTypeSeeds.map(typeSeed =>
			prisma.type.create({
				data: {
					code: typeSeed.code,
					name: typeSeed.name,
					activities: { connect: [{ id: activity.id }] }
				}
			})
		)
	)

	const typeByCode = new Map(types.map(type => [type.code, type]))
	const commonAttributes = await createCommonAttributes(
		types.map(type => type.id)
	)

	await prisma.attributeEnumValue.createMany({
		data: brandEnumValues.map((item, index) => ({
			attributeId: commonAttributes.brand.id,
			value: item.value,
			displayName: item.displayName,
			displayOrder: index + 1,
			businessId: item.businessId ?? null
		}))
	})

	const brandValues = await prisma.attributeEnumValue.findMany({
		where: { attributeId: commonAttributes.brand.id },
		orderBy: { displayOrder: 'asc' }
	})
	const brandByValue = new Map(brandValues.map(item => [item.value, item]))

	const typeContexts = new Map<string, TypeContext>()

	for (const typeSeed of catalogTypeSeeds) {
		const type = typeByCode.get(typeSeed.code)
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
				isHidden: typeSeed.uniqueAttribute.isHidden ?? false,
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
				isHidden: typeSeed.variantAttribute.isHidden ?? false,
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
				displayOrder: enumIndex + 1,
				businessId: item.businessId ?? null
			}))
		})

		const variantEnumValues = await prisma.attributeEnumValue.findMany({
			where: { attributeId: variantAttribute.id },
			orderBy: { displayOrder: 'asc' }
		})

		typeContexts.set(typeSeed.code, {
			typeId: type.id,
			typeName: type.name,
			uniqueAttributeId: uniqueAttribute.id,
			uniqueAttributeDataType: uniqueAttribute.dataType,
			variantAttributeId: variantAttribute.id,
			variantAttributeKey: variantAttribute.key,
			variantEnumValues: variantEnumValues.map(item => ({
				id: item.id,
				value: item.value
			}))
		})
	}

	const now = new Date()
	const discountStartAt = new Date(now.getTime() - 24 * 60 * 60 * 1000)
	const discountEndAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

	const mediaCache = new Map<string, string>()
	const createdCatalogs: string[] = []

	for (const catalogSeed of catalogSeeds) {
		const typeContext = typeContexts.get(catalogSeed.typeCode)
		if (!typeContext) {
			throw new Error(`Type context for "${catalogSeed.typeCode}" was not created`)
		}

		const catalog = await prisma.catalog.create({
			data: {
				slug: catalogSeed.slug,
				domain: catalogSeed.domain,
				name: catalogSeed.name,
				typeId: typeContext.typeId,
				userId: catalogOwner.id,
				config: {
					create: {
						status: CatalogStatus.OPERATIONAL,
						about: catalogSeed.about,
						description: catalogSeed.description,
						currency: catalogSeed.currency
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

		const logoMediaId = await getOrCreateMedia(
			catalog.id,
			catalogSeed.logoUrl,
			mediaCache
		)
		const bgMediaId = await getOrCreateMedia(
			catalog.id,
			catalogSeed.bgUrl,
			mediaCache
		)

		await prisma.catalogConfig.update({
			where: { catalogId: catalog.id },
			data: {
				logoMediaId,
				bgMediaId
			}
		})

		const catalogUrl = `https://${catalogSeed.domain}`
		await prisma.seoSetting.create({
			data: {
				catalogId: catalog.id,
				entityType: SeoEntityType.CATALOG,
				entityId: catalog.id,
				urlPath: '/',
				canonicalUrl: catalogUrl,
				title: `${catalogSeed.name} catalog`,
				description: catalogSeed.description,
				ogTitle: `${catalogSeed.name} catalog`,
				ogDescription: catalogSeed.about,
				ogMediaId: logoMediaId,
				ogType: 'website',
				ogUrl: catalogUrl,
				ogSiteName: catalogSeed.name,
				ogLocale: 'en_US',
				twitterCard: 'summary_large_image',
				twitterTitle: `${catalogSeed.name} catalog`,
				twitterDescription: catalogSeed.about,
				twitterMediaId: bgMediaId
			}
		})

		const categoryBySlug = new Map<
			string,
			{ id: string; position: number; imageMediaId: string }
		>()

		for (const categorySeed of catalogSeed.categories) {
			const imageMediaId = await getOrCreateMedia(
				catalog.id,
				categorySeed.imageUrl,
				mediaCache
			)

			const category = await prisma.category.create({
				data: {
					catalogId: catalog.id,
					name: categorySeed.name,
					position: categorySeed.position,
					descriptor: categorySeed.descriptor,
					discount: categorySeed.discount,
					imageMediaId
				}
			})

			categoryBySlug.set(categorySeed.slug, {
				id: category.id,
				position: categorySeed.position,
				imageMediaId
			})

			await prisma.seoSetting.create({
				data: {
					catalogId: catalog.id,
					entityType: SeoEntityType.CATEGORY,
					entityId: category.id,
					urlPath: `/categories/${categorySeed.slug}`,
					title: `${categorySeed.name} | ${catalogSeed.name}`,
					description:
						categorySeed.descriptor ?? `Catalog section ${categorySeed.name}`,
					ogTitle: `${categorySeed.name} | ${catalogSeed.name}`,
					ogDescription:
						categorySeed.descriptor ?? `Catalog section ${categorySeed.name}`,
					ogMediaId: imageMediaId,
					ogType: 'website',
					ogUrl: `${catalogUrl}/categories/${categorySeed.slug}`,
					ogSiteName: catalogSeed.name,
					ogLocale: 'en_US',
					twitterCard: 'summary_large_image',
					twitterTitle: `${categorySeed.name} | ${catalogSeed.name}`,
					twitterDescription:
						categorySeed.descriptor ?? `Catalog section ${categorySeed.name}`,
					twitterMediaId: imageMediaId
				}
			})
		}

		const categoryProductPosition = new Map<string, number>()
		let productPosition = 0

		for (const productSeed of catalogSeed.products) {
			const category = categoryBySlug.get(productSeed.categorySlug)
			if (!category) {
				throw new Error(
					`Category "${productSeed.categorySlug}" was not found for product "${productSeed.sku}"`
				)
			}

			const basePrice = new Prisma.Decimal(productSeed.price)
			const discount = productSeed.discountPercent ?? 0
			const discountedPrice = basePrice
				.mul(new Prisma.Decimal(100 - discount))
				.div(100)
				.toDecimalPlaces(2)

			const product = await prisma.product.create({
				data: {
					catalogId: catalog.id,
					sku: productSeed.sku,
					name: productSeed.name,
					slug: productSeed.slug,
					price: basePrice,
					status: ProductStatus.ACTIVE,
					isPopular: productSeed.isPopular ?? false,
					position: productPosition
				}
			})
			productPosition += 1

			const currentCategoryPosition =
				categoryProductPosition.get(productSeed.categorySlug) ?? 0

			await prisma.categoryProduct.create({
				data: {
					categoryId: category.id,
					productId: product.id,
					position: currentCategoryPosition
				}
			})
			categoryProductPosition.set(
				productSeed.categorySlug,
				currentCategoryPosition + 1
			)

			const selectedBrand = brandByValue.get(productSeed.brandValue)
			if (!selectedBrand) {
				throw new Error(
					`Brand enum value "${productSeed.brandValue}" is not defined`
				)
			}

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
					valueString: productSeed.subtitle
				}
			})

			await prisma.productAttribute.create({
				data: {
					productId: product.id,
					attributeId: commonAttributes.about.id,
					valueString: productSeed.about
				}
			})

			await prisma.productAttribute.create({
				data: {
					productId: product.id,
					attributeId: commonAttributes.description.id,
					valueString: productSeed.description
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

			await createTypedProductAttribute(
				product.id,
				typeContext.uniqueAttributeId,
				typeContext.uniqueAttributeDataType,
				productSeed.uniqueValue
			)

			for (const [variantIndex, enumValue] of typeContext.variantEnumValues
				.slice(0, 3)
				.entries()) {
				const status =
					variantIndex === 2
						? ProductVariantStatus.OUT_OF_STOCK
						: ProductVariantStatus.ACTIVE
				const stock =
					status === ProductVariantStatus.OUT_OF_STOCK ? 0 : 12 - variantIndex * 3

				const variant = await prisma.productVariant.create({
					data: {
						productId: product.id,
						sku: `${product.sku}-${variantSkuSegment(enumValue.value)}`,
						variantKey: `${typeContext.variantAttributeKey}=${enumValue.value}`,
						stock,
						price: basePrice,
						status,
						isAvailable: status === ProductVariantStatus.ACTIVE
					}
				})

				await prisma.variantAttribute.create({
					data: {
						variantId: variant.id,
						attributeId: typeContext.variantAttributeId,
						enumValueId: enumValue.id
					}
				})
			}

			const productMediaIds: string[] = []
			for (const [mediaPosition, mediaUrl] of productSeed.mediaUrls.entries()) {
				const mediaId = await getOrCreateMedia(catalog.id, mediaUrl, mediaCache)
				productMediaIds.push(mediaId)

				await prisma.productMedia.create({
					data: {
						productId: product.id,
						mediaId,
						position: mediaPosition,
						kind: mediaPosition === 0 ? 'main' : 'gallery'
					}
				})
			}

			const seoMediaId = productMediaIds[0] ?? category.imageMediaId

			await prisma.seoSetting.create({
				data: {
					catalogId: catalog.id,
					entityType: SeoEntityType.PRODUCT,
					entityId: product.id,
					urlPath: `/products/${product.slug}`,
					title: `${product.name} | ${catalogSeed.name}`,
					description: productSeed.description,
					ogTitle: `${product.name} | ${catalogSeed.name}`,
					ogDescription: productSeed.about,
					ogMediaId: seoMediaId,
					ogType: 'product',
					ogUrl: `${catalogUrl}/products/${product.slug}`,
					ogSiteName: catalogSeed.name,
					ogLocale: 'en_US',
					twitterCard: 'summary_large_image',
					twitterTitle: `${product.name} | ${catalogSeed.name}`,
					twitterDescription: productSeed.about,
					twitterMediaId: seoMediaId
				}
			})
		}
	}

	console.log('Seed completed:', {
		users: [admin.login, catalogOwner.login],
		types: catalogTypeSeeds.map(type => type.code),
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
