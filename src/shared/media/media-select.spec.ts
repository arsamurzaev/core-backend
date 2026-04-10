import { buildMediaSelect, buildMediaVariantWhere } from './media-select'

describe('media-select', () => {
	it('does not add variant filter when variant names are omitted', () => {
		const select = buildMediaSelect()

		expect(select.variants).not.toHaveProperty('where')
	})

	it('builds variant filter for card variants with legacy aliases', () => {
		expect(buildMediaVariantWhere(['card'])).toEqual({
			OR: [
				{ kind: 'card' },
				{ kind: { startsWith: 'card-' } },
				{ kind: 'md' },
				{ kind: { startsWith: 'md-' } }
			]
		})
	})

	it('builds variant filter for thumb and detail variants with legacy aliases', () => {
		expect(buildMediaVariantWhere(['thumb', 'detail'])).toEqual({
			OR: [
				{ kind: 'thumb' },
				{ kind: { startsWith: 'thumb-' } },
				{ kind: 'sm' },
				{ kind: { startsWith: 'sm-' } },
				{ kind: 'detail' },
				{ kind: { startsWith: 'detail-' } },
				{ kind: 'xl' },
				{ kind: { startsWith: 'xl-' } }
			]
		})
	})
})
