import { PrismaPg } from '@prisma/adapter-pg'
import { hash } from 'argon2'
import 'dotenv/config'

import { Prisma, PrismaClient } from './generated/client.js'

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
		data: { code: 'RU-MOW', name: 'Moscow' }
	})
	const regionSpb = await prisma.regionality.create({
		data: { code: 'RU-SPE', name: 'Saint Petersburg' }
	})
	const regionNyc = await prisma.regionality.create({
		data: { code: 'US-NYC', name: 'New York' }
	})
	const regionBer = await prisma.regionality.create({
		data: { code: 'DE-BE', name: 'Berlin' }
	})
	const regionDub = await prisma.regionality.create({
		data: { code: 'AE-DU', name: 'Dubai' }
	})
	const regionSfo = await prisma.regionality.create({
		data: { code: 'US-SFO', name: 'San Francisco' }
	})

	const admin = await prisma.user.create({
		data: {
			name: 'Admin',
			login: 'admin',
			password: passwordHash,
			role: 'ADMIN',
			isEmailConfirmed: true,
			regions: { connect: [{ id: regionMow.id }, { id: regionNyc.id }] }
		}
	})
	const catalogUserLumen = await prisma.user.create({
		data: {
			name: 'Lumen Owner',
			login: 'lumen',
			password: passwordHash,
			role: 'CATALOG',
			isEmailConfirmed: true,
			regions: { connect: [{ id: regionMow.id }, { id: regionSpb.id }] }
		}
	})
	const catalogUserLumenOutlet = await prisma.user.create({
		data: {
			name: 'Lumen Outlet Owner',
			login: 'lumen-outlet',
			password: passwordHash,
			role: 'CATALOG',
			isEmailConfirmed: true,
			regions: { connect: [{ id: regionSpb.id }] }
		}
	})
	const catalogUserGreen = await prisma.user.create({
		data: {
			name: 'Green Spoon Owner',
			login: 'green-spoon',
			password: passwordHash,
			role: 'CATALOG',
			isEmailConfirmed: true,
			regions: { connect: [{ id: regionMow.id }] }
		}
	})
	const catalogUserUrban = await prisma.user.create({
		data: {
			name: 'Urban Cafe Owner',
			login: 'urban-cafe',
			password: passwordHash,
			role: 'CATALOG',
			isEmailConfirmed: true,
			regions: { connect: [{ id: regionNyc.id }, { id: regionSfo.id }] }
		}
	})
	const catalogUserNova = await prisma.user.create({
		data: {
			name: 'Nova Tech Owner',
			login: 'nova-tech',
			password: passwordHash,
			role: 'CATALOG',
			isEmailConfirmed: true,
			regions: { connect: [{ id: regionNyc.id }, { id: regionBer.id }] }
		}
	})
	const catalogUserGlow = await prisma.user.create({
		data: {
			name: 'Glow Owner',
			login: 'glow',
			password: passwordHash,
			role: 'CATALOG',
			isEmailConfirmed: true,
			regions: { connect: [{ id: regionMow.id }, { id: regionBer.id }] }
		}
	})
	const shopper = await prisma.user.create({
		data: {
			name: 'Sample User',
			login: 'user',
			password: passwordHash,
			role: 'USER',
			isEmailConfirmed: true,
			regions: { connect: [{ id: regionSpb.id }] }
		}
	})
	const shopper2 = await prisma.user.create({
		data: {
			name: 'Second User',
			login: 'user2',
			password: passwordHash,
			role: 'USER',
			isEmailConfirmed: false,
			regions: { connect: [{ id: regionDub.id }, { id: regionNyc.id }] }
		}
	})

	const activityRetail = await prisma.activity.create({
		data: { name: 'Retail' }
	})
	const activityFood = await prisma.activity.create({
		data: { name: 'Food & Drink' }
	})
	const activityTech = await prisma.activity.create({
		data: { name: 'Electronics' }
	})
	const activityBeauty = await prisma.activity.create({
		data: { name: 'Beauty & Care' }
	})

	const typeClothing = await prisma.type.create({
		data: {
			code: 'clothing',
			name: 'Clothing & Accessories',
			activities: { connect: [{ id: activityRetail.id }] }
		}
	})
	const typeRestaurant = await prisma.type.create({
		data: {
			code: 'restaurant',
			name: 'Restaurants & Cafes',
			activities: { connect: [{ id: activityFood.id }] }
		}
	})
	const typeElectronics = await prisma.type.create({
		data: {
			code: 'electronics',
			name: 'Electronics & Gadgets',
			activities: { connect: [{ id: activityTech.id }] }
		}
	})
	const typeBeauty = await prisma.type.create({
		data: {
			code: 'beauty',
			name: 'Beauty & Care',
			activities: {
				connect: [{ id: activityBeauty.id }, { id: activityRetail.id }]
			}
		}
	})

	const attrBrand = await prisma.attribute.create({
		data: {
			typeId: typeClothing.id,
			key: 'brand',
			displayName: 'Brand',
			dataType: 'ENUM',
			isRequired: true,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 1
		}
	})
	const attrSize = await prisma.attribute.create({
		data: {
			typeId: typeClothing.id,
			key: 'size',
			displayName: 'Size',
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
			displayName: 'Color',
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
			displayName: 'Material',
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
			displayName: 'Fit',
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
			displayName: 'Gender',
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
			displayName: 'Season',
			dataType: 'ENUM',
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 7
		}
	})

	const attrIngredients = await prisma.attribute.create({
		data: {
			typeId: typeRestaurant.id,
			key: 'ingredients',
			displayName: 'Ingredients',
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
			displayName: 'Calories',
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
			displayName: 'Vegan',
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
			displayName: 'Weight',
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
			displayName: 'Spicy Level',
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
			displayName: 'Allergens',
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
			displayName: 'Cooking Time (min)',
			dataType: 'INTEGER',
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 7
		}
	})

	const attrTechBrand = await prisma.attribute.create({
		data: {
			typeId: typeElectronics.id,
			key: 'brand',
			displayName: 'Brand',
			dataType: 'ENUM',
			isRequired: true,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 1
		}
	})
	const attrTechColor = await prisma.attribute.create({
		data: {
			typeId: typeElectronics.id,
			key: 'color',
			displayName: 'Color',
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
			displayName: 'Screen Size',
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
			displayName: 'Memory',
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
			displayName: 'Storage',
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
			displayName: 'Battery (mAh)',
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
			displayName: 'Refurbished',
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
			displayName: 'Warranty (months)',
			dataType: 'INTEGER',
			isRequired: false,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 8
		}
	})

	const attrBeautyBrand = await prisma.attribute.create({
		data: {
			typeId: typeBeauty.id,
			key: 'brand',
			displayName: 'Brand',
			dataType: 'ENUM',
			isRequired: true,
			isVariantAttribute: false,
			isFilterable: true,
			displayOrder: 1
		}
	})
	const attrBeautyVolume = await prisma.attribute.create({
		data: {
			typeId: typeBeauty.id,
			key: 'volume',
			displayName: 'Volume',
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
			displayName: 'Skin Type',
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
			displayName: 'Organic',
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
			displayName: 'Color',
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
	const sizeXs = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrSize.id,
			value: 'xs',
			displayName: 'XS',
			displayOrder: 1
		}
	})
	const sizeS = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrSize.id,
			value: 's',
			displayName: 'S',
			displayOrder: 2
		}
	})
	const sizeM = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrSize.id,
			value: 'm',
			displayName: 'M',
			displayOrder: 3
		}
	})
	const sizeL = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrSize.id,
			value: 'l',
			displayName: 'L',
			displayOrder: 4
		}
	})
	const sizeXl = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrSize.id,
			value: 'xl',
			displayName: 'XL',
			displayOrder: 5
		}
	})
	const colorWhite = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrColor.id,
			value: 'white',
			displayName: 'White',
			displayOrder: 1
		}
	})
	const colorBlack = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrColor.id,
			value: 'black',
			displayName: 'Black',
			displayOrder: 2
		}
	})
	const colorBlue = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrColor.id,
			value: 'blue',
			displayName: 'Blue',
			displayOrder: 3
		}
	})
	const colorRed = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrColor.id,
			value: 'red',
			displayName: 'Red',
			displayOrder: 4
		}
	})

	const fitRegular = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrFit.id,
			value: 'regular',
			displayName: 'Regular',
			displayOrder: 1
		}
	})
	const fitSlim = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrFit.id,
			value: 'slim',
			displayName: 'Slim',
			displayOrder: 2
		}
	})
	const fitOversize = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrFit.id,
			value: 'oversize',
			displayName: 'Oversize',
			displayOrder: 3
		}
	})

	const genderMen = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrGender.id,
			value: 'men',
			displayName: 'Men',
			displayOrder: 1
		}
	})
	const genderWomen = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrGender.id,
			value: 'women',
			displayName: 'Women',
			displayOrder: 2
		}
	})
	const genderUnisex = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrGender.id,
			value: 'unisex',
			displayName: 'Unisex',
			displayOrder: 3
		}
	})

	const seasonSummer = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrSeason.id,
			value: 'summer',
			displayName: 'Summer',
			displayOrder: 1
		}
	})
	const seasonWinter = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrSeason.id,
			value: 'winter',
			displayName: 'Winter',
			displayOrder: 2
		}
	})
	const seasonAll = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrSeason.id,
			value: 'all-season',
			displayName: 'All Season',
			displayOrder: 3
		}
	})

	const spicyMild = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrSpicy.id,
			value: 'mild',
			displayName: 'Mild',
			displayOrder: 1
		}
	})
	const spicyMedium = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrSpicy.id,
			value: 'medium',
			displayName: 'Medium',
			displayOrder: 2
		}
	})
	const spicyHot = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrSpicy.id,
			value: 'hot',
			displayName: 'Hot',
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
			displayName: 'Black',
			displayOrder: 1
		}
	})
	const techColorSilver = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrTechColor.id,
			value: 'silver',
			displayName: 'Silver',
			displayOrder: 2
		}
	})
	const techColorBlue = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrTechColor.id,
			value: 'blue',
			displayName: 'Blue',
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
			displayName: 'Dry',
			displayOrder: 1
		}
	})
	const skinOily = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrBeautySkinType.id,
			value: 'oily',
			displayName: 'Oily',
			displayOrder: 2
		}
	})
	const skinNormal = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrBeautySkinType.id,
			value: 'normal',
			displayName: 'Normal',
			displayOrder: 3
		}
	})

	const beautyColorNude = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrBeautyColor.id,
			value: 'nude',
			displayName: 'Nude',
			displayOrder: 1
		}
	})
	const beautyColorRed = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrBeautyColor.id,
			value: 'red',
			displayName: 'Red',
			displayOrder: 2
		}
	})
	const beautyColorRose = await prisma.attributeEnumValue.create({
		data: {
			attributeId: attrBeautyColor.id,
			value: 'rose',
			displayName: 'Rose',
			displayOrder: 3
		}
	})

	const catalogLumen = await prisma.catalog.create({
		data: {
			slug: 'lumen',
			domain: 'lumen.demo',
			name: 'Lumen Apparel',
			typeId: typeClothing.id,
			userId: catalogUserLumen.id,
			activity: { connect: [{ id: activityRetail.id }] },
			region: { connect: [{ id: regionMow.id }, { id: regionSpb.id }] }
		}
	})
	const catalogLumenOutlet = await prisma.catalog.create({
		data: {
			slug: 'lumen-outlet',
			name: 'Lumen Outlet',
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
			name: 'Green Spoon',
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
			name: 'Urban Cafe',
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
			name: 'Nova Tech',
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
			name: 'Glow Beauty',
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
				about: 'Minimalist basics for everyday wear.',
				description: 'Seasonal collections and essentials.',
				currency: 'RUB',
				logoUrl: square('lumen-logo'),
				bgUrl: img('lumen-hero', 1600, 900),
				status: 'OPERATIONAL',
				note: 'Seed data'
			},
			{
				catalogId: catalogLumenOutlet.id,
				about: 'Outlet for last season items.',
				description: 'Limited stock and special prices.',
				currency: 'RUB',
				logoUrl: square('lumen-outlet-logo'),
				bgUrl: img('lumen-outlet-hero', 1600, 900),
				status: 'PROPOSAL',
				note: 'Seed data'
			},
			{
				catalogId: catalogGreen.id,
				about: 'Fresh food made daily.',
				description: 'Burgers, salads, and sides.',
				currency: 'RUB',
				logoUrl: square('greenspoon-logo'),
				bgUrl: img('greenspoon-hero', 1600, 900),
				status: 'OPERATIONAL',
				note: 'Seed data'
			},
			{
				catalogId: catalogUrban.id,
				about: 'Coffee, pastries, and brunch.',
				description: 'Downtown cafe with seasonal menu.',
				currency: 'USD',
				logoUrl: square('urbancafe-logo'),
				bgUrl: img('urbancafe-hero', 1600, 900),
				status: 'OPERATIONAL',
				note: 'Seed data'
			},
			{
				catalogId: catalogNova.id,
				about: 'Devices and accessories for everyday life.',
				description: 'Smartphones, laptops, and audio gear.',
				currency: 'USD',
				logoUrl: square('novatech-logo'),
				bgUrl: img('novatech-hero', 1600, 900),
				status: 'IMPLEMENTATION',
				note: 'Seed data'
			},
			{
				catalogId: catalogGlow.id,
				about: 'Skincare essentials and daily rituals.',
				description: 'Clean formulas and minimalist routines.',
				currency: 'EUR',
				logoUrl: square('glow-logo'),
				bgUrl: img('glow-hero', 1600, 900),
				status: 'PROPOSAL',
				note: 'Seed data'
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
			name: 'Men',
			position: 1,
			imageUrl: img('category-men', 800, 800),
			descriptor: 'Menswear essentials'
		}
	})
	const categoryWomen = await prisma.category.create({
		data: {
			catalogId: catalogLumen.id,
			name: 'Women',
			position: 2,
			imageUrl: img('category-women', 800, 800),
			descriptor: 'Womenswear staples'
		}
	})
	const categoryAccessories = await prisma.category.create({
		data: {
			catalogId: catalogLumen.id,
			name: 'Accessories',
			position: 3,
			imageUrl: img('category-accessories', 800, 800),
			descriptor: 'Bags and accessories',
			discount: 10
		}
	})
	const categoryTshirts = await prisma.category.create({
		data: {
			catalogId: catalogLumen.id,
			name: 'T-Shirts',
			position: 1,
			parentId: categoryMen.id,
			imageUrl: img('category-tshirts', 800, 800),
			descriptor: 'Everyday tees'
		}
	})
	const categoryJeans = await prisma.category.create({
		data: {
			catalogId: catalogLumen.id,
			name: 'Jeans',
			position: 2,
			parentId: categoryMen.id,
			imageUrl: img('category-jeans', 800, 800),
			descriptor: 'Slim and regular fits'
		}
	})
	const categoryHoodies = await prisma.category.create({
		data: {
			catalogId: catalogLumen.id,
			name: 'Hoodies',
			position: 3,
			parentId: categoryMen.id,
			imageUrl: img('category-hoodies', 800, 800),
			descriptor: 'Warm layers'
		}
	})
	const categoryDresses = await prisma.category.create({
		data: {
			catalogId: catalogLumen.id,
			name: 'Dresses',
			position: 1,
			parentId: categoryWomen.id,
			imageUrl: img('category-dresses', 800, 800),
			descriptor: 'Seasonal dresses'
		}
	})
	const categoryTops = await prisma.category.create({
		data: {
			catalogId: catalogLumen.id,
			name: 'Tops',
			position: 2,
			parentId: categoryWomen.id,
			imageUrl: img('category-tops', 800, 800),
			descriptor: 'Everyday tops'
		}
	})
	const categoryOutletSale = await prisma.category.create({
		data: {
			catalogId: catalogLumenOutlet.id,
			name: 'Sale',
			position: 1,
			imageUrl: img('category-outlet-sale', 800, 800),
			descriptor: 'Limited time deals',
			discount: 30
		}
	})
	const categoryOutletLastChance = await prisma.category.create({
		data: {
			catalogId: catalogLumenOutlet.id,
			name: 'Last Chance',
			position: 2,
			imageUrl: img('category-outlet-last', 800, 800),
			descriptor: 'Final stock',
			discount: 40
		}
	})
	const categoryBurgers = await prisma.category.create({
		data: {
			catalogId: catalogGreen.id,
			name: 'Burgers',
			position: 1,
			imageUrl: img('category-burgers', 800, 800),
			descriptor: 'Classic and signature'
		}
	})
	const categorySalads = await prisma.category.create({
		data: {
			catalogId: catalogGreen.id,
			name: 'Salads',
			position: 2,
			imageUrl: img('category-salads', 800, 800),
			descriptor: 'Fresh and light'
		}
	})
	const categoryDrinks = await prisma.category.create({
		data: {
			catalogId: catalogGreen.id,
			name: 'Drinks',
			position: 3,
			imageUrl: img('category-drinks', 800, 800),
			descriptor: 'Fresh drinks'
		}
	})
	const categoryDesserts = await prisma.category.create({
		data: {
			catalogId: catalogGreen.id,
			name: 'Desserts',
			position: 4,
			imageUrl: img('category-desserts', 800, 800),
			descriptor: 'Sweet bites',
			discount: 5
		}
	})
	const categoryCoffee = await prisma.category.create({
		data: {
			catalogId: catalogUrban.id,
			name: 'Coffee',
			position: 1,
			imageUrl: img('category-coffee', 800, 800),
			descriptor: 'Coffee classics'
		}
	})
	const categoryPastries = await prisma.category.create({
		data: {
			catalogId: catalogUrban.id,
			name: 'Pastries',
			position: 2,
			imageUrl: img('category-pastries', 800, 800),
			descriptor: 'Baked daily'
		}
	})
	const categoryPhones = await prisma.category.create({
		data: {
			catalogId: catalogNova.id,
			name: 'Phones',
			position: 1,
			imageUrl: img('category-phones', 800, 800),
			descriptor: 'Smartphones'
		}
	})
	const categoryLaptops = await prisma.category.create({
		data: {
			catalogId: catalogNova.id,
			name: 'Laptops',
			position: 2,
			imageUrl: img('category-laptops', 800, 800),
			descriptor: 'Laptops and notebooks'
		}
	})
	const categoryGadgets = await prisma.category.create({
		data: {
			catalogId: catalogNova.id,
			name: 'Gadgets',
			position: 3,
			imageUrl: img('category-gadgets', 800, 800),
			descriptor: 'Audio and accessories'
		}
	})
	const categorySkincare = await prisma.category.create({
		data: {
			catalogId: catalogGlow.id,
			name: 'Skincare',
			position: 1,
			imageUrl: img('category-skincare', 800, 800),
			descriptor: 'Skincare essentials'
		}
	})
	const categoryMakeup = await prisma.category.create({
		data: {
			catalogId: catalogGlow.id,
			name: 'Makeup',
			position: 2,
			imageUrl: img('category-makeup', 800, 800),
			descriptor: 'Makeup picks'
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
			name: 'Basic T-Shirt',
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
			name: 'Slim Jeans',
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
			name: 'Classic Hoodie',
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
			name: 'Linen Shirt',
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
			name: 'Summer Dress',
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
			name: 'Silk Top',
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
			name: 'Canvas Tote',
			slug: 'canvas-tote',
			price: tshirtPrice,
			imagesUrls: [img('product-tote-1')],
			isPopular: false,
			status: 'ACTIVE',
			position: 7
		}
	})
	const productOutletTshirt = await prisma.product.create({
		data: {
			catalogId: catalogLumenOutlet.id,
			sku: 'OUT-TSHIRT-001',
			name: 'Outlet T-Shirt',
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
			name: 'Outlet Jacket',
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
			name: 'Outlet Jeans',
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
			name: 'Classic Burger',
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
			name: 'Vegan Salad',
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
			name: 'Chicken Wrap',
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
			name: 'Fresh Juice',
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
			name: 'Chocolate Cake',
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
			name: 'Espresso',
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
			name: 'Cappuccino',
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
			name: 'Butter Croissant',
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
			name: 'Nova Phone X',
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
			name: 'Nova Laptop Air',
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
			name: 'Nova Earbuds',
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
			name: 'Glow Serum',
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
			name: 'Velvet Lipstick',
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
			name: 'Nude Lipstick',
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
			name: 'Rose Blush',
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
			name: 'Daily Cleanser',
			slug: 'daily-cleanser',
			price: cleanserPrice,
			imagesUrls: [img('product-cleanser-1')],
			isPopular: false,
			status: 'DRAFT',
			position: 5
		}
	})

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
			}
		]
	})

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
				valueString: '100% cotton'
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
				valueString: '98% cotton, 2% elastane'
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
				valueString: '80% cotton, 20% polyester'
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
				valueString: '100% linen'
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
				valueString: 'Viscose blend'
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
				valueString: 'Silk blend'
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
				valueString: 'Canvas'
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
				valueString: 'Cotton blend'
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
				valueString: 'Nylon shell'
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
				valueString: 'Denim'
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
				valueString: 'Beef, bun, lettuce, tomato, sauce'
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
				valueString: 'gluten'
			},
			{
				productId: productBurger.id,
				attributeId: attrCookingTime.id,
				valueInteger: 12
			},
			{
				productId: productSalad.id,
				attributeId: attrIngredients.id,
				valueString: 'Mixed greens, avocado, cucumber, seeds'
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
				valueString: 'nuts'
			},
			{
				productId: productSalad.id,
				attributeId: attrCookingTime.id,
				valueInteger: 6
			},
			{
				productId: productWrap.id,
				attributeId: attrIngredients.id,
				valueString: 'Chicken, tortilla, greens, sauce'
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
				valueString: 'gluten'
			},
			{
				productId: productWrap.id,
				attributeId: attrCookingTime.id,
				valueInteger: 8
			},
			{
				productId: productJuice.id,
				attributeId: attrIngredients.id,
				valueString: 'Apple, ginger, lemon'
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
				valueString: 'none'
			},
			{
				productId: productJuice.id,
				attributeId: attrCookingTime.id,
				valueInteger: 2
			},
			{
				productId: productCake.id,
				attributeId: attrIngredients.id,
				valueString: 'Cocoa, flour, sugar, butter'
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
				valueString: 'gluten, dairy, eggs'
			},
			{
				productId: productCake.id,
				attributeId: attrCookingTime.id,
				valueInteger: 15
			},
			{
				productId: productEspresso.id,
				attributeId: attrIngredients.id,
				valueString: 'Arabica beans, water'
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
				valueString: 'none'
			},
			{
				productId: productEspresso.id,
				attributeId: attrCookingTime.id,
				valueInteger: 3
			},
			{
				productId: productCappuccino.id,
				attributeId: attrIngredients.id,
				valueString: 'Coffee, milk, foam'
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
				valueString: 'dairy'
			},
			{
				productId: productCappuccino.id,
				attributeId: attrCookingTime.id,
				valueInteger: 4
			},
			{
				productId: productCroissant.id,
				attributeId: attrIngredients.id,
				valueString: 'Butter, flour, sugar'
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
				valueString: 'gluten, dairy'
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
			}
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
		const variant = await prisma.productVariant.create({
			data: {
				productId,
				sku,
				variantKey: `size=${size.value};color=${color.value}`,
				stock,
				price,
				isAvailable: stock > 0
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
				title: 'Home',
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
				name: 'John Doe',
				phone: '+1 555 030 0003',
				email: 'john@example.com',
				message: 'Interested in size M.',
				meta: { source: 'product_page' }
			},
			{
				catalogId: catalogGreen.id,
				sessionId: sessionGreen.id,
				channel: 'PHONE',
				status: 'QUALIFIED',
				productId: productBurger.id,
				categoryId: categoryBurgers.id,
				name: 'Alex Green',
				phone: '+1 555 030 0004',
				message: 'Need a catering order.',
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
				name: 'Sam Tech',
				email: 'sam@example.com',
				message: 'Question about shipping.',
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
				title: 'Lumen Apparel',
				description: 'Modern basics for everyday wear.',
				keywords: 'tshirts, jeans, basics',
				h1: 'Lumen Apparel',
				seoText: 'Shop modern basics and seasonal collections.',
				robots: 'index,follow',
				ogTitle: 'Lumen Apparel',
				ogDescription: 'Modern basics for everyday wear.',
				ogImage: img('lumen-og', 1200, 630),
				ogType: 'website',
				ogUrl: `${baseUrl(catalogLumen)}/`,
				ogSiteName: 'Lumen Apparel',
				ogLocale: 'en_US',
				twitterCard: 'summary_large_image',
				twitterTitle: 'Lumen Apparel',
				twitterDescription: 'Modern basics for everyday wear.',
				twitterImage: img('lumen-twitter', 1200, 630),
				twitterSite: '@lumen',
				twitterCreator: '@lumen',
				hreflang: { en: `${baseUrl(catalogLumen)}/` },
				structuredData: {
					'@context': 'https://schema.org',
					'@type': 'Store',
					name: 'Lumen Apparel'
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
				title: 'T-Shirts',
				description: 'Everyday tees and basics.',
				keywords: 'tshirts, basics',
				h1: 'T-Shirts',
				seoText: 'Find your everyday tees.',
				robots: 'index,follow',
				ogTitle: 'T-Shirts',
				ogDescription: 'Everyday tees and basics.',
				ogImage: img('tshirts-og', 1200, 630),
				ogType: 'website',
				ogUrl: `${baseUrl(catalogLumen)}/category/t-shirts`,
				ogSiteName: 'Lumen Apparel',
				ogLocale: 'en_US',
				twitterCard: 'summary_large_image',
				twitterTitle: 'T-Shirts',
				twitterDescription: 'Everyday tees and basics.',
				twitterImage: img('tshirts-twitter', 1200, 630),
				twitterSite: '@lumen',
				twitterCreator: '@lumen',
				hreflang: { en: `${baseUrl(catalogLumen)}/category/t-shirts` },
				structuredData: {
					'@context': 'https://schema.org',
					'@type': 'CollectionPage',
					name: 'T-Shirts'
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
				description: 'Soft cotton T-Shirt in classic colors.',
				keywords: 'tshirt, cotton, basics',
				h1: productTshirt.name,
				seoText: 'Soft cotton tee for everyday wear.',
				robots: 'index,follow',
				ogTitle: productTshirt.name,
				ogDescription: 'Soft cotton T-Shirt in classic colors.',
				ogImage: img('tshirt-og', 1200, 630),
				ogType: 'product',
				ogUrl: `${baseUrl(catalogLumen)}/product/${productTshirt.slug}`,
				ogSiteName: 'Lumen Apparel',
				ogLocale: 'en_US',
				twitterCard: 'summary_large_image',
				twitterTitle: productTshirt.name,
				twitterDescription: 'Soft cotton T-Shirt in classic colors.',
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
				title: 'Lumen Outlet',
				description: 'Last season items and limited stock.',
				keywords: 'outlet, sale, fashion',
				h1: 'Lumen Outlet',
				seoText: 'Shop outlet deals and limited stock.',
				robots: 'index,follow',
				ogTitle: 'Lumen Outlet',
				ogDescription: 'Last season items and limited stock.',
				ogImage: img('lumen-outlet-og', 1200, 630),
				ogType: 'website',
				ogUrl: `${baseUrl(catalogLumenOutlet)}/`,
				ogSiteName: 'Lumen Outlet',
				ogLocale: 'en_US',
				twitterCard: 'summary_large_image',
				twitterTitle: 'Lumen Outlet',
				twitterDescription: 'Last season items and limited stock.',
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
				title: 'Green Spoon',
				description: 'Fresh food made daily.',
				keywords: 'burgers, salads, cafe',
				h1: 'Green Spoon',
				seoText: 'Fresh food made daily.',
				robots: 'index,follow',
				ogTitle: 'Green Spoon',
				ogDescription: 'Fresh food made daily.',
				ogImage: img('greenspoon-og', 1200, 630),
				ogType: 'website',
				ogUrl: `${baseUrl(catalogGreen)}/`,
				ogSiteName: 'Green Spoon',
				ogLocale: 'en_US',
				twitterCard: 'summary_large_image',
				twitterTitle: 'Green Spoon',
				twitterDescription: 'Fresh food made daily.',
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
				title: 'Burgers',
				description: 'Classic and signature burgers.',
				keywords: 'burgers, grill',
				h1: 'Burgers',
				seoText: 'Explore our burger selection.',
				robots: 'index,follow',
				ogTitle: 'Burgers',
				ogDescription: 'Classic and signature burgers.',
				ogImage: img('burgers-og', 1200, 630),
				ogType: 'website',
				ogUrl: `${baseUrl(catalogGreen)}/category/burgers`,
				ogSiteName: 'Green Spoon',
				ogLocale: 'en_US',
				twitterCard: 'summary_large_image',
				twitterTitle: 'Burgers',
				twitterDescription: 'Classic and signature burgers.',
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
				description: 'Juicy burger with fresh toppings.',
				keywords: 'burger, grill',
				h1: productBurger.name,
				seoText: 'Juicy burger with fresh toppings.',
				robots: 'index,follow',
				ogTitle: productBurger.name,
				ogDescription: 'Juicy burger with fresh toppings.',
				ogImage: img('burger-og', 1200, 630),
				ogType: 'product',
				ogUrl: `${baseUrl(catalogGreen)}/product/${productBurger.slug}`,
				ogSiteName: 'Green Spoon',
				ogLocale: 'en_US',
				twitterCard: 'summary_large_image',
				twitterTitle: productBurger.name,
				twitterDescription: 'Juicy burger with fresh toppings.',
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
				title: 'Urban Cafe',
				description: 'Coffee and pastries downtown.',
				h1: 'Urban Cafe',
				robots: 'index,follow',
				ogTitle: 'Urban Cafe',
				ogDescription: 'Coffee and pastries downtown.',
				ogImage: img('urban-og', 1200, 630),
				ogType: 'website',
				ogUrl: `${baseUrl(catalogUrban)}/`,
				ogSiteName: 'Urban Cafe',
				ogLocale: 'en_US',
				twitterCard: 'summary_large_image',
				twitterTitle: 'Urban Cafe',
				twitterDescription: 'Coffee and pastries downtown.',
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
				title: 'Nova Tech',
				description: 'Devices and accessories for everyday life.',
				keywords: 'phones, laptops, gadgets',
				h1: 'Nova Tech',
				robots: 'index,follow',
				ogTitle: 'Nova Tech',
				ogDescription: 'Devices and accessories for everyday life.',
				ogImage: img('novatech-og', 1200, 630),
				ogType: 'website',
				ogUrl: `${baseUrl(catalogNova)}/`,
				ogSiteName: 'Nova Tech',
				ogLocale: 'en_US',
				twitterCard: 'summary_large_image',
				twitterTitle: 'Nova Tech',
				twitterDescription: 'Devices and accessories for everyday life.',
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
				title: 'Phones',
				description: 'Smartphones and accessories.',
				keywords: 'phones, smartphones',
				h1: 'Phones',
				seoText: 'Discover our smartphone lineup.',
				robots: 'index,follow',
				ogTitle: 'Phones',
				ogDescription: 'Smartphones and accessories.',
				ogImage: img('phones-og', 1200, 630),
				ogType: 'website',
				ogUrl: `${baseUrl(catalogNova)}/category/phones`,
				ogSiteName: 'Nova Tech',
				ogLocale: 'en_US',
				twitterCard: 'summary_large_image',
				twitterTitle: 'Phones',
				twitterDescription: 'Smartphones and accessories.',
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
				description: 'Flagship phone with a stunning display.',
				keywords: 'phone, smartphone',
				h1: productPhone.name,
				seoText: 'Flagship phone with a stunning display.',
				robots: 'index,follow',
				ogTitle: productPhone.name,
				ogDescription: 'Flagship phone with a stunning display.',
				ogImage: img('phone-og', 1200, 630),
				ogType: 'product',
				ogUrl: `${baseUrl(catalogNova)}/product/${productPhone.slug}`,
				ogSiteName: 'Nova Tech',
				ogLocale: 'en_US',
				twitterCard: 'summary_large_image',
				twitterTitle: productPhone.name,
				twitterDescription: 'Flagship phone with a stunning display.',
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
				title: 'Glow Beauty',
				description: 'Skincare essentials and daily rituals.',
				keywords: 'skincare, beauty',
				h1: 'Glow Beauty',
				robots: 'index,follow',
				ogTitle: 'Glow Beauty',
				ogDescription: 'Skincare essentials and daily rituals.',
				ogImage: img('glow-og', 1200, 630),
				ogType: 'website',
				ogUrl: `${baseUrl(catalogGlow)}/`,
				ogSiteName: 'Glow Beauty',
				ogLocale: 'en_US',
				twitterCard: 'summary_large_image',
				twitterTitle: 'Glow Beauty',
				twitterDescription: 'Skincare essentials and daily rituals.',
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
				title: 'Skincare',
				description: 'Skincare essentials for daily routines.',
				keywords: 'skincare, routines',
				h1: 'Skincare',
				seoText: 'Skincare essentials for daily routines.',
				robots: 'index,follow',
				ogTitle: 'Skincare',
				ogDescription: 'Skincare essentials for daily routines.',
				ogImage: img('skincare-og', 1200, 630),
				ogType: 'website',
				ogUrl: `${baseUrl(catalogGlow)}/category/skincare`,
				ogSiteName: 'Glow Beauty',
				ogLocale: 'en_US',
				twitterCard: 'summary_large_image',
				twitterTitle: 'Skincare',
				twitterDescription: 'Skincare essentials for daily routines.',
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
				description: 'Hydrating serum for daily use.',
				keywords: 'serum, skincare',
				h1: productSerum.name,
				seoText: 'Hydrating serum for daily use.',
				robots: 'index,follow',
				ogTitle: productSerum.name,
				ogDescription: 'Hydrating serum for daily use.',
				ogImage: img('serum-og', 1200, 630),
				ogType: 'product',
				ogUrl: `${baseUrl(catalogGlow)}/product/${productSerum.slug}`,
				ogSiteName: 'Glow Beauty',
				ogLocale: 'en_US',
				twitterCard: 'summary_large_image',
				twitterTitle: productSerum.name,
				twitterDescription: 'Hydrating serum for daily use.',
				twitterImage: img('serum-twitter', 1200, 630),
				twitterSite: '@glowbeauty',
				twitterCreator: '@glowbeauty',
				extras: { seed: true },
				sitemapPriority: 0.7,
				sitemapChangeFreq: 'WEEKLY'
			}
		]
	})

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
