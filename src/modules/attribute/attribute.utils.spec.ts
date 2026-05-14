import {
	buildEnumValueBase,
	normalizeAttributeDictionaryText,
	normalizeAttributeEnumValue,
	normalizeAttributeKey,
	normalizeAttributeLabel
} from './attribute.utils'

describe('attribute utils', () => {
	it('normalizes dictionary text with NFKC, collapsed spaces and trim', () => {
		expect(normalizeAttributeDictionaryText('  Black\t\tXL  ')).toBe('Black XL')
		expect(normalizeAttributeDictionaryText(' ＡＢＣ  １２３ ')).toBe('ABC 123')
	})

	it('normalizes attribute keys and enum values through the same search key rules', () => {
		expect(normalizeAttributeKey('  Size\tEU  ')).toBe('size eu')
		expect(normalizeAttributeEnumValue('  Чёрный   XL  ')).toBe('чёрный xl')
	})

	it('keeps labels display-friendly while removing unstable whitespace', () => {
		expect(normalizeAttributeLabel('  Чёрный   XL  ')).toBe('Чёрный XL')
	})

	it('builds enum value slugs from normalized text', () => {
		expect(buildEnumValueBase('  BLACK   XL  ')).toBe('black-xl')
	})
})
