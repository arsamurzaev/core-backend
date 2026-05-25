import { ForbiddenException, Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

import {
	CAPABILITY_CATALOG_SALE_UNITS,
	CAPABILITY_INTEGRATION_IIKO,
	CAPABILITY_INTEGRATION_MOYSKLAD,
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

export type CatalogCapabilityDefinitionDto = {
	key: CatalogCapability
	title: string
	description: string
	dependsOn: CatalogCapability[]
}

export type CatalogCapabilityStateDto = {
	key: CatalogCapability
	raw: boolean
	effective: boolean
	disabledReason: string | null
}

export type CatalogCapabilitiesDto = {
	raw: CatalogCapabilityFlagMap
	effective: CatalogCapabilityFlagMap
	flags: CatalogCapabilityFlags
	definitions: CatalogCapabilityDefinitionDto[]
	items: CatalogCapabilityStateDto[]
}

@Injectable()
export class CapabilityService {
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

	canUseInternalInventory(catalogId: string, at = new Date()) {
		return this.can(catalogId, CAPABILITY_INVENTORY_INTERNAL, at)
	}

	canUseMoySkladIntegration(catalogId: string, at = new Date()) {
		return this.can(catalogId, CAPABILITY_INTEGRATION_MOYSKLAD, at)
	}

	canUseIikoIntegration(catalogId: string, at = new Date()) {
		return this.can(catalogId, CAPABILITY_INTEGRATION_IIKO, at)
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
			message ?? reason ?? 'Feature is not enabled for this catalog'
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
			'Product types are not enabled for this catalog'
		)
	}

	async assertCanUseProductVariants(catalogId: string) {
		await this.assert(
			catalogId,
			CAPABILITY_PRODUCT_VARIANTS,
			'Product variants are not enabled for this catalog'
		)
	}

	async assertCanUseCatalogSaleUnits(catalogId: string) {
		await this.assert(
			catalogId,
			CAPABILITY_CATALOG_SALE_UNITS,
			'Catalog sale units are not enabled for this catalog'
		)
	}

	async assertCanUseInternalInventory(catalogId: string) {
		await this.assert(
			catalogId,
			CAPABILITY_INVENTORY_INTERNAL,
			'Internal inventory is not enabled for this catalog'
		)
	}

	async assertCanUseMoySkladIntegration(catalogId: string) {
		await this.assert(
			catalogId,
			CAPABILITY_INTEGRATION_MOYSKLAD,
			'MoySklad integration is not enabled for this catalog'
		)
	}

	async assertCanUseIikoIntegration(catalogId: string) {
		await this.assert(
			catalogId,
			CAPABILITY_INTEGRATION_IIKO,
			'iiko integration is not enabled for this catalog'
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
						entitlement.enabled &&
						(!entitlement.expiresAt || entitlement.expiresAt > at)
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
		if (!raw[capability]) return 'Capability is disabled for this catalog'

		const definition = CATALOG_CAPABILITY_DEFINITION_BY_KEY.get(capability)
		const missingDependency = definition?.dependsOn.find(
			dependency => !effective[dependency]
		)
		if (!missingDependency) return 'Capability is not available'

		const dependency = CATALOG_CAPABILITY_DEFINITION_BY_KEY.get(missingDependency)
		return `Requires ${dependency?.title ?? missingDependency}`
	}

	private toFlags(effective: CatalogCapabilityFlagMap): CatalogCapabilityFlags {
		return {
			canUseProductTypes: effective[CAPABILITY_PRODUCT_TYPES],
			canUseProductVariants: effective[CAPABILITY_PRODUCT_VARIANTS],
			canUseCatalogSaleUnits: effective[CAPABILITY_CATALOG_SALE_UNITS],
			canUseInternalInventory: effective[CAPABILITY_INVENTORY_INTERNAL],
			canUseMoySkladIntegration: effective[CAPABILITY_INTEGRATION_MOYSKLAD],
			canUseIikoIntegration: effective[CAPABILITY_INTEGRATION_IIKO]
		}
	}
}
