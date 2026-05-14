import type { Prisma } from '@generated/client'
import { Injectable } from '@nestjs/common'
import { createHash } from 'crypto'
import slugify from 'slugify'

import { IntegrationRepository } from '../../integration.repository'
import type { IntegrationVariantAttributeValueInput } from '../../integration.repository'

const MOYSKLAD_NAME_MAX_LENGTH = 255
const MOYSKLAD_ENUM_VALUE_MAX_LENGTH = 255

type VariantAttributeDefinition = {
	id: string
	key: string
	displayName: string
	displayOrder: number
}

export type ResolvedMoySkladVariantAttribute =
	IntegrationVariantAttributeValueInput & {
		key: string
		attributeDisplayName: string
		displayOrder: number
	}

@Injectable()
export class MoySkladVariantAttributeResolverService {
	constructor(private readonly repo: IntegrationRepository) {}

	async resolveForVariant(params: {
		catalogId: string
		metadata: unknown
		characteristics: unknown
		tx?: Prisma.TransactionClient
	}): Promise<ResolvedMoySkladVariantAttribute[]> {
		const usedKeys = new Set<string>()
		const attributes: ResolvedMoySkladVariantAttribute[] = []
		const items = normalizeCharacteristics(params.characteristics)

		for (let index = 0; index < items.length; index += 1) {
			const characteristic = items[index]
			const name = readMoySkladString(characteristic.name)
			const displayName = truncateMoySkladText(
				name || `Option ${index + 1}`,
				MOYSKLAD_NAME_MAX_LENGTH
			)
			const valueDisplayName = truncateMoySkladText(
				readMoySkladString(characteristic.value),
				MOYSKLAD_NAME_MAX_LENGTH
			)
			if (!valueDisplayName) {
				continue
			}

			const mappedAttributeId = this.readStoredMoySkladAttributeMappingId(
				params.metadata,
				normalizeMoySkladMappingName(displayName)
			)
			const mappedDefinition = mappedAttributeId
				? await this.findMappedDefinition({
						catalogId: params.catalogId,
						attributeId: mappedAttributeId,
						tx: params.tx
					})
				: null
			const definition =
				mappedDefinition ??
				(await this.upsertDefinition({
					catalogId: params.catalogId,
					key: buildMoySkladVariantAttributeKey(displayName, index, usedKeys),
					displayName,
					tx: params.tx
				}))
			usedKeys.add(definition.key)

			attributes.push({
				attributeId: definition.id,
				key: definition.key,
				attributeDisplayName: definition.displayName,
				displayOrder: definition.displayOrder,
				value: normalizeVariantEnumValue(valueDisplayName),
				displayName: valueDisplayName
			})
		}

		return this.dedupe(attributes)
	}

	buildVariantKey(attributes: ResolvedMoySkladVariantAttribute[]): string {
		if (!attributes.length) {
			return ''
		}

		const key = attributes
			.map(attribute => `${attribute.key}=${attribute.value}`)
			.join(';')

		if (key.length <= 300) {
			return key
		}

		const hash = createHash('sha1').update(key).digest('hex').slice(0, 16)
		return `moysklad=${hash}`
	}

	private async findMappedDefinition(params: {
		catalogId: string
		attributeId: string
		tx?: Prisma.TransactionClient
	}): Promise<VariantAttributeDefinition | null> {
		const raw: unknown = await this.repo.findMoySkladVariantAttributeById(
			params.catalogId,
			params.attributeId,
			params.tx
		)
		return toVariantAttributeDefinition(raw)
	}

	private async upsertDefinition(params: {
		catalogId: string
		key: string
		displayName: string
		tx?: Prisma.TransactionClient
	}): Promise<VariantAttributeDefinition> {
		const raw: unknown = await this.repo.upsertMoySkladVariantAttribute(
			params.catalogId,
			{
				key: params.key,
				displayName: params.displayName
			},
			params.tx
		)
		const definition = toVariantAttributeDefinition(raw)
		if (!definition) {
			throw new Error('MoySklad variant attribute definition was not resolved')
		}

		return definition
	}

	private dedupe(
		attributes: ResolvedMoySkladVariantAttribute[]
	): ResolvedMoySkladVariantAttribute[] {
		const byAttributeId = new Map<string, ResolvedMoySkladVariantAttribute>()
		for (const attribute of attributes) {
			byAttributeId.set(attribute.attributeId, attribute)
		}

		return [...byAttributeId.values()].sort(compareResolvedAttributes)
	}

	private readStoredMoySkladAttributeMappingId(
		metadata: unknown,
		normalizedName: string
	): string | null {
		if (!isRecord(metadata)) return null
		const mapping = metadata.moySkladMapping
		if (!isRecord(mapping)) return null
		const attributes = mapping.attributes
		if (!isRecord(attributes)) return null
		const attributeId = attributes[normalizedName]
		if (typeof attributeId !== 'string') return null
		const normalized = attributeId.trim()
		return normalized || null
	}
}

function normalizeCharacteristics(
	value: unknown
): Array<Record<'name' | 'value', unknown>> {
	if (!Array.isArray(value)) {
		return []
	}

	return value.filter(isRecord).map(item => ({
		name: item.name,
		value: item.value
	}))
}

function toVariantAttributeDefinition(
	value: unknown
): VariantAttributeDefinition | null {
	if (!isRecord(value)) {
		return null
	}

	const id = readMoySkladString(value.id)
	const key = readMoySkladString(value.key)
	const displayName = readMoySkladString(value.displayName)
	const displayOrder = Number(value.displayOrder)
	if (!id || !key || !displayName || !Number.isFinite(displayOrder)) {
		return null
	}

	return {
		id,
		key,
		displayName,
		displayOrder
	}
}

function compareResolvedAttributes(
	left: ResolvedMoySkladVariantAttribute,
	right: ResolvedMoySkladVariantAttribute
): number {
	return (
		left.displayOrder - right.displayOrder || left.key.localeCompare(right.key)
	)
}

function buildMoySkladVariantAttributeKey(
	displayName: string,
	index: number,
	usedKeys: Set<string>
): string {
	const slug = slugifyValue(displayName, true).replace(/-/g, '_')
	const base = `moysklad_${slug || `option_${index + 1}`}`.slice(0, 92)
	let key = base
	let suffix = 1

	while (usedKeys.has(key)) {
		suffix += 1
		key = `${base}_${suffix}`.slice(0, 100)
	}

	usedKeys.add(key)
	return key
}

function normalizeVariantEnumValue(value: string): string {
	return truncateMoySkladText(
		value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase(),
		MOYSKLAD_ENUM_VALUE_MAX_LENGTH
	)
}

function normalizeMoySkladMappingName(value: string): string {
	return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
}

function truncateMoySkladText(value: string, maxLength: number): string {
	const normalized = value.trim()
	if (normalized.length <= maxLength) {
		return normalized
	}

	const hash = createHash('sha1').update(normalized).digest('hex').slice(0, 8)
	const headLength = Math.max(0, maxLength - hash.length - 1)
	const head = normalized.slice(0, headLength).trimEnd()
	return `${head}-${hash}`
}

function slugifyValue(value: string, lower: boolean): string {
	const slug = slugify(value, { lower, strict: true, trim: true })
	return slug.replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '')
}

function readMoySkladString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
