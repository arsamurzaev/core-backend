import { ForbiddenException, Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { isInclusiveExpiryActive } from '@/shared/utils'

import {
	CAPABILITY_CATALOG_MODIFIERS,
	CAPABILITY_CATALOG_PRICE_LISTS,
	CAPABILITY_CATALOG_SALE_UNITS,
	CAPABILITY_INTEGRATION_IIKO,
	CAPABILITY_INTEGRATION_MOYSKLAD,
	CAPABILITY_INTEGRATION_ONE_C,
	CAPABILITY_INVENTORY_INTERNAL,
	CAPABILITY_PRODUCT_TYPES,
	CAPABILITY_PRODUCT_VARIANTS,
	CATALOG_CAPABILITIES,
	CATALOG_CAPABILITY_DEFINITION_BY_KEY,
	CATALOG_CAPABILITY_DEFINITIONS,
	type CatalogCapability,
	type CatalogCapabilityFlagMap,
	type CatalogCapabilityFlags
} from './capability.constants'
import type {
	CapabilityAssertPort,
	CapabilityReaderPort,
	CatalogCapabilitiesDto,
	CatalogCapabilityDefinitionDto
} from './contracts'

@Injectable()
export class CapabilityService
	implements CapabilityReaderPort, CapabilityAssertPort
{
	constructor(private readonly prisma: PrismaService) {}

	getDefinitions(): CatalogCapabilityDefinitionDto[] {
		return CATALOG_CAPABILITY_DEFINITIONS.map(definition => ({
			key: definition.key,
			title: definition.title,
			description: definition.description,
			dependsOn: [...definition.dependsOn]
		}))
	}

	async can(catalogId: string, capability: CatalogCapability, at = new Date()) {
		const state = await this.getCatalogCapabilities(catalogId, at)
		return state.effective[capability] === true
	}

	async getCatalogCapabilities(
		catalogId: string,
		at = new Date()
	): Promise<CatalogCapabilitiesDto> {
		const raw = await this.getRawCapabilityMap(catalogId, at)
		const effective = this.resolveEffectiveCapabilityMap(raw)
		const flags = this.toFlags(effective)
		const definitions = this.getDefinitions()
		const items = definitions.map(definition => ({
			key: definition.key,
			raw: raw[definition.key],
			effective: effective[definition.key],
			disabledReason: this.resolveDisabledReason(definition.key, raw, effective)
		}))

		return {
			raw,
			effective,
			flags,
			definitions,
			items
		}
	}

	async getCurrentFeatures(catalogId: string, at = new Date()) {
		const capabilities = await this.getCatalogCapabilities(catalogId, at)
		return capabilities.flags
	}

	canUseProductTypes(catalogId: string, at = new Date()) {
		return this.can(catalogId, CAPABILITY_PRODUCT_TYPES, at)
	}

	canUseProductVariants(catalogId: string, at = new Date()) {
		return this.can(catalogId, CAPABILITY_PRODUCT_VARIANTS, at)
	}

	canUseCatalogSaleUnits(catalogId: string, at = new Date()) {
		return this.can(catalogId, CAPABILITY_CATALOG_SALE_UNITS, at)
	}

	canUseCatalogModifiers(catalogId: string, at = new Date()) {
		return this.can(catalogId, CAPABILITY_CATALOG_MODIFIERS, at)
	}

	canUseCatalogPriceLists(catalogId: string, at = new Date()) {
		return this.can(catalogId, CAPABILITY_CATALOG_PRICE_LISTS, at)
	}

	canUseInternalInventory(catalogId: string, at = new Date()) {
		return this.can(catalogId, CAPABILITY_INVENTORY_INTERNAL, at)
	}

	canUseMoySkladIntegration(catalogId: string, at = new Date()) {
		return this.can(catalogId, CAPABILITY_INTEGRATION_MOYSKLAD, at)
	}

	canUseIikoIntegration(catalogId: string, at = new Date()) {
		return this.can(catalogId, CAPABILITY_INTEGRATION_IIKO, at)
	}

	canUseOneCIntegration(catalogId: string, at = new Date()) {
		return this.can(catalogId, CAPABILITY_INTEGRATION_ONE_C, at)
	}

	async assert(
		catalogId: string,
		capability: CatalogCapability,
		message?: string
	) {
		const capabilities = await this.getCatalogCapabilities(catalogId)
		if (capabilities.effective[capability]) return

		const reason = capabilities.items.find(
			item => item.key === capability
		)?.disabledReason
		throw new ForbiddenException(
			message ?? reason ?? 'Функция не включена для этого каталога'
		)
	}

	async assertCanUse(
		catalogId: string,
		capability: CatalogCapability,
		message?: string
	) {
		await this.assert(catalogId, capability, message)
	}

	async assertCanUseProductTypes(catalogId: string) {
		await this.assert(
			catalogId,
			CAPABILITY_PRODUCT_TYPES,
			'Типы товаров не включены для этого каталога'
		)
	}

	async assertCanUseProductVariants(catalogId: string) {
		await this.assert(
			catalogId,
			CAPABILITY_PRODUCT_VARIANTS,
			'Вариации не включены для этого каталога'
		)
	}

	async assertCanUseCatalogSaleUnits(catalogId: string) {
		await this.assert(
			catalogId,
			CAPABILITY_CATALOG_SALE_UNITS,
			'Единицы продажи не включены для этого каталога'
		)
	}

	async assertCanUseCatalogModifiers(catalogId: string) {
		await this.assert(
			catalogId,
			CAPABILITY_CATALOG_MODIFIERS,
			'Модификаторы не включены для этого каталога'
		)
	}

	async assertCanUseCatalogPriceLists(catalogId: string) {
		await this.assert(
			catalogId,
			CAPABILITY_CATALOG_PRICE_LISTS,
			'Прайс-листы не включены для этого каталога'
		)
	}

	async assertCanUseInternalInventory(catalogId: string) {
		await this.assert(
			catalogId,
			CAPABILITY_INVENTORY_INTERNAL,
			'Собственный склад не включен для этого каталога'
		)
	}

	async assertCanUseMoySkladIntegration(catalogId: string) {
		await this.assert(
			catalogId,
			CAPABILITY_INTEGRATION_MOYSKLAD,
			'Интеграция МойСклад не включена для этого каталога'
		)
	}

	async assertCanUseIikoIntegration(catalogId: string) {
		await this.assert(
			catalogId,
			CAPABILITY_INTEGRATION_IIKO,
			'Интеграция iiko не включена для этого каталога'
		)
	}

	async assertCanUseOneCIntegration(catalogId: string) {
		await this.assert(
			catalogId,
			CAPABILITY_INTEGRATION_ONE_C,
			'Интеграция 1C не включена для этого каталога'
		)
	}

	private async getRawCapabilityMap(
		catalogId: string,
		at: Date
	): Promise<CatalogCapabilityFlagMap> {
		const entitlements = await this.prisma.catalogFeatureEntitlement.findMany({
			where: {
				catalogId,
				feature: { in: [...CATALOG_CAPABILITIES] }
			},
			select: {
				feature: true,
				enabled: true,
				expiresAt: true
			}
		})
		const enabledFeatures = new Set(
			entitlements
				.filter(
					entitlement =>
						entitlement.enabled && isInclusiveExpiryActive(entitlement.expiresAt, at)
				)
				.map(entitlement => entitlement.feature)
		)

		return Object.fromEntries(
			CATALOG_CAPABILITIES.map(capability => [
				capability,
				enabledFeatures.has(capability)
			])
		) as CatalogCapabilityFlagMap
	}

	private resolveEffectiveCapabilityMap(
		raw: CatalogCapabilityFlagMap
	): CatalogCapabilityFlagMap {
		const effective = { ...raw }

		for (const definition of CATALOG_CAPABILITY_DEFINITIONS) {
			if (!raw[definition.key]) {
				effective[definition.key] = false
				continue
			}
			effective[definition.key] = definition.dependsOn.every(
				dependency => effective[dependency]
			)
		}

		return effective
	}

	private resolveDisabledReason(
		capability: CatalogCapability,
		raw: CatalogCapabilityFlagMap,
		effective: CatalogCapabilityFlagMap
	): string | null {
		if (effective[capability]) return null
		if (!raw[capability]) return 'Функция отключена для этого каталога'

		const definition = CATALOG_CAPABILITY_DEFINITION_BY_KEY.get(capability)
		const missingDependency = definition?.dependsOn.find(
			dependency => !effective[dependency]
		)
		if (!missingDependency) return 'Функция недоступна'

		const dependency = CATALOG_CAPABILITY_DEFINITION_BY_KEY.get(missingDependency)
		return `Требуется функция: ${dependency?.title ?? missingDependency}`
	}

	private toFlags(effective: CatalogCapabilityFlagMap): CatalogCapabilityFlags {
		return {
			canUseProductTypes: effective[CAPABILITY_PRODUCT_TYPES],
			canUseProductVariants: effective[CAPABILITY_PRODUCT_VARIANTS],
			canUseCatalogSaleUnits: effective[CAPABILITY_CATALOG_SALE_UNITS],
			canUseCatalogModifiers: effective[CAPABILITY_CATALOG_MODIFIERS],
			canUseCatalogPriceLists: effective[CAPABILITY_CATALOG_PRICE_LISTS],
			canUseInternalInventory: effective[CAPABILITY_INVENTORY_INTERNAL],
			canUseMoySkladIntegration: effective[CAPABILITY_INTEGRATION_MOYSKLAD],
			canUseIikoIntegration: effective[CAPABILITY_INTEGRATION_IIKO],
			canUseOneCIntegration: effective[CAPABILITY_INTEGRATION_ONE_C]
		}
	}
}
