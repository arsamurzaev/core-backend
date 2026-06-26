import { CatalogDomainCronService } from './catalog-domain.cron.service'

describe('CatalogDomainCronService', () => {
	const originalDomainCheckLimit = process.env.CATALOG_DOMAIN_CHECK_LIMIT
	const originalDomainCheckEnabled = process.env.CATALOG_DOMAIN_CHECK_ENABLED
	const restoreEnv = (key: string, value: string | undefined) => {
		if (value === undefined) {
			delete process.env[key]
			return
		}

		process.env[key] = value
	}

	afterEach(() => {
		restoreEnv('CATALOG_DOMAIN_CHECK_LIMIT', originalDomainCheckLimit)
		restoreEnv('CATALOG_DOMAIN_CHECK_ENABLED', originalDomainCheckEnabled)
	})

	it('checks pending domains and records success metrics', async () => {
		process.env.CATALOG_DOMAIN_CHECK_LIMIT = '7'
		delete process.env.CATALOG_DOMAIN_CHECK_ENABLED
		const domains = {
			checkPendingDomains: jest.fn().mockResolvedValue(2)
		}
		const observability = { recordCronRun: jest.fn() }
		const service = new CatalogDomainCronService(
			domains as any,
			observability as any
		)
		const loggerLog = jest
			.spyOn((service as any).logger, 'log')
			.mockImplementation(() => undefined)

		await service.checkPendingDomains()

		expect(domains.checkPendingDomains).toHaveBeenCalledWith(7)
		expect(observability.recordCronRun).toHaveBeenCalledWith(
			'catalog-domain-check',
			'success',
			expect.any(Number)
		)
		loggerLog.mockRestore()
	})

	it('records an error metric without throwing', async () => {
		delete process.env.CATALOG_DOMAIN_CHECK_ENABLED
		const domains = {
			checkPendingDomains: jest.fn().mockRejectedValue(new Error('dns failed'))
		}
		const observability = { recordCronRun: jest.fn() }
		const service = new CatalogDomainCronService(
			domains as any,
			observability as any
		)
		const loggerError = jest
			.spyOn((service as any).logger, 'error')
			.mockImplementation(() => undefined)

		await expect(service.checkPendingDomains()).resolves.toBeUndefined()

		expect(domains.checkPendingDomains).toHaveBeenCalledTimes(1)
		expect(observability.recordCronRun).toHaveBeenCalledWith(
			'catalog-domain-check',
			'error',
			expect.any(Number)
		)
		loggerError.mockRestore()
	})

	it('does not run when domain checking is disabled', async () => {
		process.env.CATALOG_DOMAIN_CHECK_ENABLED = 'false'
		const domains = {
			checkPendingDomains: jest.fn()
		}
		const observability = { recordCronRun: jest.fn() }
		const service = new CatalogDomainCronService(
			domains as any,
			observability as any
		)

		await service.checkPendingDomains()

		expect(domains.checkPendingDomains).not.toHaveBeenCalled()
		expect(observability.recordCronRun).not.toHaveBeenCalled()
	})
})
