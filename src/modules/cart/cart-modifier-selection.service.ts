import type { Prisma } from '@generated/client'
import { BadRequestException, Injectable } from '@nestjs/common'

import type { NormalizedCartItemModifierInput } from './cart.utils'

export type ResolvedCartModifier = {
	productModifierGroupId: string
	productModifierOptionId: string
	catalogModifierGroupId: string | null
	catalogModifierOptionId: string | null
	groupCode: string
	groupName: string
	optionCode: string
	optionName: string
	quantity: number
	unitPriceSnapshot: Prisma.Decimal | number | string
}

export type ResolvedCartModifiers = {
	signature: string
	items: ResolvedCartModifier[]
}

const modifierGroupSelect = {
	id: true,
	variantId: true,
	catalogModifierGroupId: true,
	code: true,
	name: true,
	isRequired: true,
	minSelected: true,
	maxSelected: true,
	isActive: true,
	displayOrder: true,
	options: {
		where: {
			deleteAt: null,
			isAvailable: true
		},
		select: {
			id: true,
			catalogModifierOptionId: true,
			code: true,
			name: true,
			price: true,
			maxQuantity: true,
			isAvailable: true,
			displayOrder: true
		},
		orderBy: [
			{ displayOrder: 'asc' as const },
			{ name: 'asc' as const },
			{ id: 'asc' as const }
		]
	}
} satisfies Prisma.ProductModifierGroupSelect

type ModifierGroup = Prisma.ProductModifierGroupGetPayload<{
	select: typeof modifierGroupSelect
}>

@Injectable()
export class CartModifierSelectionService {
	async resolveModifiers(
		tx: Prisma.TransactionClient,
		params: {
			productId: string
			variantId: string | null
			canUseCatalogModifiers: boolean
			modifiers: NormalizedCartItemModifierInput[]
		}
	): Promise<ResolvedCartModifiers> {
		if (!params.canUseCatalogModifiers) {
			if (params.modifiers.length) {
				throw new BadRequestException('Модификаторы не включены для этого каталога')
			}
			return { signature: '', items: [] }
		}

		const groups = await this.findApplicableGroups(tx, params)
		if (!groups.length) {
			if (params.modifiers.length) {
				throw new BadRequestException('Модификаторы товара недоступны')
			}
			return { signature: '', items: [] }
		}

		const groupsById = new Map(groups.map(group => [group.id, group]))
		const selectedByGroup = new Map<string, ResolvedCartModifier[]>()

		for (const input of params.modifiers) {
			const group = groupsById.get(input.productModifierGroupId)
			if (!group) {
				throw new BadRequestException(
					'Группа модификаторов недоступна для выбранного товара'
				)
			}
			const option = group.options.find(
				item => item.id === input.productModifierOptionId
			)
			if (!option) {
				throw new BadRequestException(
					'Опция модификатора недоступна для выбранного товара'
				)
			}
			if (option.maxQuantity !== null && input.quantity > option.maxQuantity) {
				throw new BadRequestException(
					`Опцию "${option.name}" можно выбрать не больше ${option.maxQuantity}`
				)
			}
			const selected = selectedByGroup.get(group.id) ?? []
			selected.push({
				productModifierGroupId: group.id,
				productModifierOptionId: option.id,
				catalogModifierGroupId: group.catalogModifierGroupId,
				catalogModifierOptionId: option.catalogModifierOptionId,
				groupCode: group.code,
				groupName: group.name,
				optionCode: option.code,
				optionName: option.name,
				quantity: input.quantity,
				unitPriceSnapshot: option.price
			})
			selectedByGroup.set(group.id, selected)
		}

		for (const group of groups) {
			this.assertGroupSelection(group, selectedByGroup.get(group.id) ?? [])
		}

		const items = [...selectedByGroup.values()]
			.flat()
			.sort(
				(left, right) =>
					left.productModifierGroupId.localeCompare(right.productModifierGroupId) ||
					left.productModifierOptionId.localeCompare(right.productModifierOptionId)
			)
		return {
			signature: this.buildSignature(items),
			items
		}
	}

	private async findApplicableGroups(
		tx: Prisma.TransactionClient,
		params: {
			productId: string
			variantId: string | null
		}
	): Promise<ModifierGroup[]> {
		const groups = await tx.productModifierGroup.findMany({
			where: {
				productId: params.productId,
				deleteAt: null,
				isActive: true,
				OR: [
					{ variantId: null },
					...(params.variantId ? [{ variantId: params.variantId }] : [])
				]
			},
			select: modifierGroupSelect,
			orderBy: [
				{ scope: 'asc' },
				{ displayOrder: 'asc' },
				{ name: 'asc' },
				{ id: 'asc' }
			]
		})

		return groups.filter(group => group.options.length > 0)
	}

	private assertGroupSelection(
		group: ModifierGroup,
		selected: ResolvedCartModifier[]
	): void {
		const selectedQuantity = selected.reduce(
			(sum, modifier) => sum + modifier.quantity,
			0
		)
		const minSelected = group.isRequired ? Math.max(1, group.minSelected) : 0

		if (selectedQuantity < minSelected) {
			throw new BadRequestException(
				`В группе "${group.name}" нужно выбрать минимум ${minSelected}`
			)
		}
		if (group.maxSelected !== null && selectedQuantity > group.maxSelected) {
			throw new BadRequestException(
				`В группе "${group.name}" можно выбрать не больше ${group.maxSelected}`
			)
		}
	}

	private buildSignature(modifiers: ResolvedCartModifier[]): string {
		return modifiers
			.map(
				modifier =>
					`${modifier.productModifierGroupId}:${modifier.productModifierOptionId}x${modifier.quantity}`
			)
			.sort()
			.join('|')
	}
}
