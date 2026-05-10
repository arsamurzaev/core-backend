import assert from 'node:assert/strict'

import { parseCommandTokens } from './command-mode.js'
import { maskSecrets, rowsToCsv } from './format.js'
import { readSchemaMeta } from './metadata.js'

function main() {
	const schema = readSchemaMeta()
	const product = schema.models.get('Product')
	const categoryProduct = schema.models.get('CategoryProduct')

	assert.ok(product, 'Product model must be parsed')
	assert.equal(product.fields.get('id')?.isId, true)
	assert.equal(product.fields.get('sku')?.isUnique, true)
	assert.equal(product.fields.get('deleteAt')?.isRequired, false)

	assert.ok(categoryProduct, 'CategoryProduct model must be parsed')
	assert.deepEqual(categoryProduct.compoundIds[0], ['categoryId', 'productId'])

	assert.ok(
		schema.enums.get('ProductStatus')?.includes('ACTIVE'),
		'ProductStatus enum must be parsed'
	)

	const masked = maskSecrets({
		login: 'admin',
		password: 'secret',
		nested: { accessKey: 'key' }
	})
	assert.equal(masked.password, '[hidden]')
	assert.equal(masked.nested.accessKey, '[hidden]')

	const csv = rowsToCsv([{ name: 'A,B', token: 'secret' }])
	assert.ok(csv.includes('"A,B"'), 'CSV must escape commas')
	assert.ok(csv.includes('[hidden]'), 'CSV must mask secrets')

	const command = parseCommandTokens([
		'product',
		'find',
		'--where',
		'{"status":"ACTIVE"}',
		'--csv'
	])
	assert.equal(command.subject, 'product')
	assert.equal(command.action, 'find')
	assert.equal(command.options.where, '{"status":"ACTIVE"}')
	assert.equal(command.options.csv, true)

	console.log('db-console self-test passed')
}

main()
