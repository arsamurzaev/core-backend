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

type BrandSeed = {
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
		key: 'subtitle',
		displayName: 'Подзаголовок',
		dataType: DataType.STRING,
		isRequired: false,
		isVariantAttribute: false,
		isFilterable: false,
		displayOrder: 80,
		isHidden: false
	},
	{
		key: 'description',
		displayName: 'Описание',
		dataType: DataType.STRING,
		isRequired: false,
		isVariantAttribute: false,
		isFilterable: false,
		displayOrder: 82,
		isHidden: false
	},
	{
		key: 'discount',
		displayName: 'Скидка',
		dataType: DataType.INTEGER,
		isRequired: false,
		isVariantAttribute: false,
		isFilterable: false,
		displayOrder: 83,
		isHidden: false
	},
	{
		key: 'discountedPrice',
		displayName: 'Цена со скидкой',
		dataType: DataType.DECIMAL,
		isRequired: false,
		isVariantAttribute: false,
		isFilterable: false,
		displayOrder: 84,
		isHidden: false
	},
	{
		key: 'discountStartAt',
		displayName: 'Начало скидки',
		dataType: DataType.DATETIME,
		isRequired: false,
		isVariantAttribute: false,
		isFilterable: false,
		displayOrder: 85,
		isHidden: false
	},
	{
		key: 'discountEndAt',
		displayName: 'Конец скидки',
		dataType: DataType.DATETIME,
		isRequired: false,
		isVariantAttribute: false,
		isFilterable: false,
		displayOrder: 86,
		isHidden: false
	}
]

const catalogTypeSeeds: CatalogTypeSeed[] = [
	{
		code: 'restaurant',
		name: 'Рестораны',
		uniqueAttribute: {
			key: 'restaurant_cuisine',
			displayName: 'Кухня',
			dataType: DataType.STRING,
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 1
		},
		variantAttribute: {
			key: 'restaurant_portion_size',
			displayName: 'Размер порции',
			dataType: DataType.ENUM,
			isRequired: true,
			isVariantAttribute: true,
			isFilterable: true,
			displayOrder: 2,
			enumValues: [
				{ value: 'small', displayName: 'Маленький' },
				{ value: 'regular', displayName: 'Обычный' },
				{ value: 'family', displayName: 'Семейный' }
			]
		}
	},
	{
		code: 'clothing',
		name: 'Одежда',
		uniqueAttribute: {
			key: 'clothing_material',
			displayName: 'Материал',
			dataType: DataType.STRING,
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 1
		},
		variantAttribute: {
			key: 'clothing_size',
			displayName: 'Размерный ряд верхней одежды',
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

const brandSeeds: BrandSeed[] = [
	{ value: 'urban-thread', displayName: 'Urban Thread' },
	{ value: 'denim-lab', displayName: 'Denim Lab' },
	{ value: 'city-burger', displayName: 'City Burger' },
	{ value: 'pizza-yard', displayName: 'Pizza Yard' },
	{ value: 'fresh-sip', displayName: 'Fresh Sip' }
]

const MAX_POPULAR_PRODUCTS_PER_CATALOG = 8
const MAX_BRANDS_IN_SEED = 5
const DEFAULT_PRODUCTS_PER_CATEGORY_IN_SEED = 6
const MAX_PRODUCTS_PER_CATEGORY_IN_SEED = 8

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

function defaultBrandByCategory(
	typeCode: string,
	categorySlug: string
): string {
	if (typeCode === 'restaurant') {
		if (categorySlug === 'drinks') return 'fresh-sip'
		if (categorySlug === 'pizza') return 'pizza-yard'
		return 'city-burger'
	}

	if (categorySlug === 'jeans' || categorySlug === 'jackets') return 'denim-lab'
	return 'urban-thread'
}

function defaultPrice(
	typeCode: string,
	categorySlug: string,
	order: number
): string {
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

function trimToLength(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value
	return value.slice(0, maxLength)
}

function normalizeSlug(value: string): string {
	const normalized = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-+|-+$/g, '')

	return normalized.length ? normalized : 'brand'
}

function buildBrandName(displayName: string): string {
	return trimToLength(displayName.trim(), 255)
}

function buildBrandSlug(brandValue: string): string {
	return trimToLength(normalizeSlug(brandValue), 255)
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

				const readableCategoryName = category.name
					.replace(/[^a-zA-Z0-9а-яА-ЯёЁ]+/g, ' ')
					.trim()
				const productName = `${readableCategoryName} товар ${nextOrder}`
				const seedPrefix = `${catalog.typeCode}-${catalog.slug}-${category.slug}-${nextOrder}`

				products.push({
					sku,
					name: productName,
					slug,
					categorySlug: category.slug,
					price: defaultPrice(catalog.typeCode, category.slug, nextOrder),
					brandValue: defaultBrandByCategory(catalog.typeCode, category.slug),
					subtitle: `${productName} для демонстрации`,
					about: `Автосгенерированный товар для категории «${category.name}».`,
					description: `Демонстрационный товар №${nextOrder} в категории «${category.name}».`,
					uniqueValue:
						catalog.typeCode === 'restaurant'
							? `Авторская кухня (${category.name})`
							: category.slug === 'jeans' || category.slug === 'jackets'
								? 'Деним'
								: 'Хлопок',
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
		about: 'Демо-каталог ресторана с бургерами, пиццей и напитками.',
		description:
			'Набор данных для тестирования категорий и карточек товаров ресторана.',
		currency: 'RUB',
		logoUrl: buildOpenSourcePhotoUrl('restaurant-city-kitchen-logo'),
		bgUrl: buildOpenSourcePhotoUrl('restaurant-city-kitchen-bg'),
		categories: [
			{
				slug: 'burgers',
				name: 'Бургеры',
				position: 0,
				descriptor: 'Бургеры на гриле и комбо-наборы',
				discount: 8,
				imageUrl: buildOpenSourcePhotoUrl(
					'restaurant-city-kitchen-category-burgers'
				)
			},
			{
				slug: 'pizza',
				name: 'Пицца',
				position: 1,
				descriptor: 'Пицца из дровяной печи',
				discount: 10,
				imageUrl: buildOpenSourcePhotoUrl('restaurant-city-kitchen-category-pizza')
			},
			{
				slug: 'drinks',
				name: 'Напитки',
				position: 2,
				descriptor: 'Освежающие холодные напитки',
				imageUrl: buildOpenSourcePhotoUrl('restaurant-city-kitchen-category-drinks')
			}
		],
		products: [
			{
				sku: 'RSTR-BURGER-001',
				name: 'Классический бургер с говядиной',
				slug: 'classic-beef-burger',
				categorySlug: 'burgers',
				price: '590.00',
				brandValue: 'city-burger',
				subtitle: 'Сочная говяжья котлета с чеддером',
				about: 'Фирменный бургер со свежими овощами и соусом шефа.',
				description:
					'Классический бургер с чеддером, маринованными огурцами и булочкой бриошь.',
				uniqueValue: 'Американская',
				discountPercent: 5,
				isPopular: true,
				mediaUrls: buildMediaGallery(
					'restaurant-city-kitchen-product-classic-beef-burger',
					2
				)
			},
			{
				sku: 'RSTR-BURGER-002',
				name: 'Криспи бургер с курицей',
				slug: 'chicken-crispy-burger',
				categorySlug: 'burgers',
				price: '540.00',
				brandValue: 'city-burger',
				subtitle: 'Хрустящая курица и острый майонез',
				about: 'Хрустящий бургер с курицей, салатом и соусом халапеньо.',
				description:
					'Куриное филе в панировке, салат, лук и острый майонез в булочке бриошь.',
				uniqueValue: 'Американская',
				discountPercent: 7,
				mediaUrls: buildMediaGallery(
					'restaurant-city-kitchen-product-chicken-crispy-burger',
					2
				)
			},
			{
				sku: 'RSTR-PIZZA-001',
				name: 'Пицца Маргарита',
				slug: 'margherita-pizza',
				categorySlug: 'pizza',
				price: '790.00',
				brandValue: 'pizza-yard',
				subtitle: 'Томатный соус, моцарелла, базилик',
				about: 'Классическая маргарита с мягким тестом и свежим базиликом.',
				description:
					'Пицца в неаполитанском стиле с моцареллой и ароматным базиликом.',
				uniqueValue: 'Итальянская',
				discountPercent: 10,
				isPopular: true,
				mediaUrls: buildMediaGallery(
					'restaurant-city-kitchen-product-margherita-pizza',
					2
				)
			},
			{
				sku: 'RSTR-PIZZA-002',
				name: 'Пицца Пепперони',
				slug: 'pepperoni-pizza',
				categorySlug: 'pizza',
				price: '890.00',
				brandValue: 'pizza-yard',
				subtitle: 'Пепперони и моцарелла',
				about: 'Пикантная пицца с пепперони и увеличенной порцией сыра.',
				description:
					'Пицца с томатной основой, колбасой пепперони и тянущейся моцареллой.',
				uniqueValue: 'Итальянская',
				discountPercent: 10,
				mediaUrls: buildMediaGallery(
					'restaurant-city-kitchen-product-pepperoni-pizza',
					2
				)
			},
			{
				sku: 'RSTR-DRINK-001',
				name: 'Цитрусовый лимонад',
				slug: 'citrus-lemonade',
				categorySlug: 'drinks',
				price: '220.00',
				brandValue: 'fresh-sip',
				subtitle: 'Фирменный домашний лимонад',
				about: 'Освежающий цитрусовый лимонад с мятой и льдом.',
				description: 'Свежий лимонад из лимона, апельсина и мяты.',
				uniqueValue: 'Напиток',
				discountPercent: 0,
				mediaUrls: buildMediaGallery(
					'restaurant-city-kitchen-product-citrus-lemonade',
					2
				)
			}
		]
	},
	{
		typeCode: 'clothing',
		slug: 'urban-style',
		domain: 'urban-style.catalog.local',
		name: 'Urban Style',
		about: 'Демо-каталог одежды: футболки, худи, джинсы и куртки.',
		description:
			'Набор данных для тестирования категорий одежды и карточек товаров.',
		currency: 'RUB',
		logoUrl: buildOpenSourcePhotoUrl('clothing-urban-style-logo'),
		bgUrl: buildOpenSourcePhotoUrl('clothing-urban-style-bg'),
		categories: [
			{
				slug: 'tshirts',
				name: 'Футболки',
				position: 0,
				descriptor: 'Базовые хлопковые модели на каждый день',
				discount: 12,
				imageUrl: buildOpenSourcePhotoUrl('clothing-urban-style-category-tshirts')
			},
			{
				slug: 'hoodies',
				name: 'Худи',
				position: 1,
				descriptor: 'Теплые худи свободного кроя',
				discount: 10,
				imageUrl: buildOpenSourcePhotoUrl('clothing-urban-style-category-hoodies')
			},
			{
				slug: 'jeans',
				name: 'Джинсы',
				position: 2,
				descriptor: 'Классические фасоны из денима',
				imageUrl: buildOpenSourcePhotoUrl('clothing-urban-style-category-jeans')
			},
			{
				slug: 'jackets',
				name: 'Куртки',
				position: 3,
				descriptor: 'Верхняя одежда и сезонные слои',
				imageUrl: buildOpenSourcePhotoUrl('clothing-urban-style-category-jackets')
			}
		],
		products: [
			{
				sku: 'CLTH-TSHIRT-001',
				name: 'Базовая хлопковая футболка',
				slug: 'basic-cotton-tee',
				categorySlug: 'tshirts',
				price: '1290.00',
				brandValue: 'urban-thread',
				subtitle: 'Мягкая повседневная футболка из хлопка',
				about: 'Минималистичная футболка для повседневных образов.',
				description: 'Футболка прямого кроя из дышащего хлопкового трикотажа.',
				uniqueValue: '100% хлопок',
				discountPercent: 15,
				isPopular: true,
				mediaUrls: buildMediaGallery(
					'clothing-urban-style-product-basic-cotton-tee',
					2
				)
			},
			{
				sku: 'CLTH-HOODIE-001',
				name: 'Оверсайз худи',
				slug: 'oversized-hoodie',
				categorySlug: 'hoodies',
				price: '2890.00',
				brandValue: 'urban-thread',
				subtitle: 'Худи свободного кроя',
				about: 'Теплое худи с мягким начесом внутри и карманом-кенгуру.',
				description:
					'Объемное худи для комфортных повседневных и streetwear-образов.',
				uniqueValue: 'Хлопковый футер',
				discountPercent: 10,
				mediaUrls: buildMediaGallery(
					'clothing-urban-style-product-oversized-hoodie',
					2
				)
			},
			{
				sku: 'CLTH-JEANS-001',
				name: 'Джинсы slim fit',
				slug: 'slim-fit-jeans',
				categorySlug: 'jeans',
				price: '3590.00',
				brandValue: 'denim-lab',
				subtitle: 'Эластичный деним',
				about: 'Удобные джинсы slim fit для ежедневной носки.',
				description:
					'Джинсы средней посадки из плотного денима с комфортной растяжимостью.',
				uniqueValue: 'Деним',
				discountPercent: 12,
				mediaUrls: buildMediaGallery(
					'clothing-urban-style-product-slim-fit-jeans',
					2
				)
			},
			{
				sku: 'CLTH-JACKET-001',
				name: 'Городская куртка-бомбер',
				slug: 'city-bomber-jacket',
				categorySlug: 'jackets',
				price: '4990.00',
				brandValue: 'denim-lab',
				subtitle: 'Легкая демисезонная куртка',
				about: 'Бомбер для прохладной весенней и осенней погоды.',
				description:
					'Куртка-бомбер в городском стиле с молнией и трикотажными манжетами.',
				uniqueValue: 'Смесовый полиэстер',
				discountPercent: 20,
				mediaUrls: buildMediaGallery(
					'clothing-urban-style-product-city-bomber-jacket',
					2
				)
			}
		]
	}
]

function resolveProductsPerCategoryTarget(): number {
	const raw = process.env.SEED_PRODUCTS_PER_CATEGORY
	if (!raw) return DEFAULT_PRODUCTS_PER_CATEGORY_IN_SEED

	const parsed = Number.parseInt(raw, 10)
	if (!Number.isFinite(parsed) || parsed < 1) {
		return DEFAULT_PRODUCTS_PER_CATEGORY_IN_SEED
	}
	return Math.min(parsed, MAX_PRODUCTS_PER_CATEGORY_IN_SEED)
}

const catalogSeeds: CatalogSeed[] = ensureProductsPerCategory(
	baseCatalogSeeds,
	resolveProductsPerCategoryTarget()
)

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
		prisma.brand.deleteMany(),
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
			name: 'Владелец каталога',
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
	const brandByValue = new Map(brandSeeds.map(item => [item.value, item]))
	const createdBrandValues = new Set<string>()
	let createdBrandsCount = 0

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
				title: `${catalogSeed.name} - каталог`,
				description: catalogSeed.description,
				ogTitle: `${catalogSeed.name} - каталог`,
				ogDescription: catalogSeed.about,
				ogMediaId: logoMediaId,
				ogType: 'website',
				ogUrl: catalogUrl,
				ogSiteName: catalogSeed.name,
				ogLocale: 'ru_RU',
				twitterCard: 'summary_large_image',
				twitterTitle: `${catalogSeed.name} - каталог`,
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
						categorySeed.descriptor ?? `Раздел каталога: ${categorySeed.name}`,
					ogTitle: `${categorySeed.name} | ${catalogSeed.name}`,
					ogDescription:
						categorySeed.descriptor ?? `Раздел каталога: ${categorySeed.name}`,
					ogMediaId: imageMediaId,
					ogType: 'website',
					ogUrl: `${catalogUrl}/categories/${categorySeed.slug}`,
					ogSiteName: catalogSeed.name,
					ogLocale: 'ru_RU',
					twitterCard: 'summary_large_image',
					twitterTitle: `${categorySeed.name} | ${catalogSeed.name}`,
					twitterDescription:
						categorySeed.descriptor ?? `Раздел каталога: ${categorySeed.name}`,
					twitterMediaId: imageMediaId
				}
			})
		}

		const categoryProductPosition = new Map<string, number>()
		let productPosition = 0
		let popularProductsCount = 0

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
			const selectedBrand = brandByValue.get(productSeed.brandValue)
			if (!selectedBrand) {
				throw new Error(
					`Brand enum value "${productSeed.brandValue}" is not defined`
				)
			}

			let productBrandId: string | null = null
			const shouldCreateBrand =
				createdBrandsCount < MAX_BRANDS_IN_SEED &&
				!createdBrandValues.has(selectedBrand.value)

			if (shouldCreateBrand) {
				const brand = await prisma.brand.create({
					data: {
						catalogId: catalog.id,
						name: buildBrandName(selectedBrand.displayName ?? selectedBrand.value),
						slug: buildBrandSlug(selectedBrand.value)
					}
				})
				productBrandId = brand.id
				createdBrandValues.add(selectedBrand.value)
				createdBrandsCount += 1
			}

			const isPopular =
				(productSeed.isPopular ?? false) &&
				popularProductsCount < MAX_POPULAR_PRODUCTS_PER_CATALOG
			if (isPopular) {
				popularProductsCount += 1
			}

			const product = await prisma.product.create({
				data: {
					catalogId: catalog.id,
					brandId: productBrandId,
					sku: productSeed.sku,
					name: productSeed.name,
					slug: productSeed.slug,
					price: basePrice,
					status: ProductStatus.ACTIVE,
					isPopular,
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
					ogLocale: 'ru_RU',
					twitterCard: 'summary_large_image',
					twitterTitle: `${product.name} | ${catalogSeed.name}`,
					twitterDescription: productSeed.about,
					twitterMediaId: seoMediaId
				}
			})
		}
	}

	console.log('Сидирование завершено:', {
		users: [admin.login, catalogOwner.login],
		types: catalogTypeSeeds.map(type => type.code),
		catalogs: createdCatalogs
	})
}

main()
	.catch(error => {
		console.error('Ошибка сидирования:', error)
		process.exitCode = 1
	})
	.finally(async () => {
		await prisma.$disconnect()
	})
