export type MoySkladSyncItemIssue = {
	code: string
	message: string
	externalId: string | null
	count?: number | null
}

export type MoySkladCatalogSyncResult = {
	ok: true
	total: number
	totalProducts: number
	totalVariants: number
	created: number
	createdProducts: number
	createdVariants: number
	updated: number
	updatedProducts: number
	updatedVariants: number
	deleted: number
	skippedProducts: number
	skippedVariants: number
	warnings: MoySkladSyncItemIssue[]
	errors: MoySkladSyncItemIssue[]
	durationMs: number
	syncedAt: Date
}

type SyncItemResult = {
	created: boolean
	updated: boolean
}

export class MoySkladCatalogSyncStats {
	private createdTotal = 0
	private createdProductTotal = 0
	private createdVariantTotal = 0
	private updatedTotal = 0
	private updatedProductTotal = 0
	private updatedVariantTotal = 0
	private deletedTotal = 0
	private successfulItemTotal = 0
	private processedVariantTotal = 0
	private readonly warningItems: MoySkladSyncItemIssue[] = []
	private readonly errorItems: MoySkladSyncItemIssue[] = []

	get created(): number {
		return this.createdTotal
	}

	get createdProducts(): number {
		return this.createdProductTotal
	}

	get createdVariants(): number {
		return this.createdVariantTotal
	}

	get updated(): number {
		return this.updatedTotal
	}

	get updatedProducts(): number {
		return this.updatedProductTotal
	}

	get updatedVariants(): number {
		return this.updatedVariantTotal
	}

	get deleted(): number {
		return this.deletedTotal
	}

	get processedVariants(): number {
		return this.processedVariantTotal
	}

	get warnings(): MoySkladSyncItemIssue[] {
		return this.warningItems
	}

	get errors(): MoySkladSyncItemIssue[] {
		return this.errorItems
	}

	recordWarning(issue: MoySkladSyncItemIssue): void {
		this.warningItems.push(issue)
	}

	recordError(issue: MoySkladSyncItemIssue): void {
		this.errorItems.push(issue)
	}

	recordProductResult(result: SyncItemResult): void {
		this.successfulItemTotal += 1
		if (result.created) {
			this.createdTotal += 1
			this.createdProductTotal += 1
			return
		}
		if (result.updated) {
			this.updatedTotal += 1
			this.updatedProductTotal += 1
		}
	}

	recordVariantResult(result: SyncItemResult): void {
		this.successfulItemTotal += 1
		this.processedVariantTotal += 1
		if (result.created) {
			this.createdTotal += 1
			this.createdVariantTotal += 1
			return
		}
		if (result.updated) {
			this.updatedTotal += 1
			this.updatedVariantTotal += 1
		}
	}

	setDeleted(count: number): void {
		this.deletedTotal = Math.max(0, Math.trunc(count))
	}

	allAttemptedItemsFailed(totalSyncItems: number): boolean {
		return (
			totalSyncItems > 0 &&
			this.successfulItemTotal === 0 &&
			this.errorItems.length > 0
		)
	}

	toCatalogResult(params: {
		total: number
		totalProducts: number
		totalVariants: number
		skippedProducts: number
		skippedVariants: number
		durationMs: number
		syncedAt: Date
	}): MoySkladCatalogSyncResult {
		return {
			ok: true,
			total: params.total,
			totalProducts: params.totalProducts,
			totalVariants: params.totalVariants,
			created: this.createdTotal,
			createdProducts: this.createdProductTotal,
			createdVariants: this.createdVariantTotal,
			updated: this.updatedTotal,
			updatedProducts: this.updatedProductTotal,
			updatedVariants: this.updatedVariantTotal,
			deleted: this.deletedTotal,
			skippedProducts: params.skippedProducts,
			skippedVariants: params.skippedVariants,
			warnings: this.warningItems,
			errors: this.errorItems,
			durationMs: params.durationMs,
			syncedAt: params.syncedAt
		}
	}
}
