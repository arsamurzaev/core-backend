import {
	CatalogSignupStatus,
	CatalogStatus,
	ContactType,
	Role
} from '@generated/enums'
import { render } from 'react-email'

import { CatalogOnboardingService } from './catalog-onboarding.service'

jest.mock('argon2', () => ({
	hash: jest.fn().mockResolvedValue('hashed-password')
}))

jest.mock('react-email', () => ({
	render: jest.fn().mockResolvedValue('<email />')
}))

function createService() {
	const prisma = {
		catalogSignup: {
			updateMany: jest.fn().mockResolvedValue({ count: 0 }),
			findFirst: jest.fn(),
			findUnique: jest.fn(),
			create: jest.fn(),
			update: jest.fn()
		},
		type: {
			findFirst: jest.fn()
		},
		user: {
			findFirst: jest.fn(),
			create: jest.fn()
		},
		catalog: {
			findUnique: jest.fn(),
			create: jest.fn()
		},
		$transaction: jest.fn()
	}
	const redis = {
		set: jest.fn().mockResolvedValue('OK'),
		del: jest.fn().mockResolvedValue(1)
	}
	const auth = {
		createSessionForUser: jest
			.fn()
			.mockResolvedValue({ sid: 'sid-1', csrf: 'csrf-1', reused: false })
	}
	const email = {
		send: jest.fn().mockResolvedValue(undefined)
	}

	const service = new CatalogOnboardingService(
		prisma as any,
		redis as any,
		auth as any,
		email as any
	)

	return { service, prisma, redis, auth, email }
}

describe('CatalogOnboardingService', () => {
	beforeEach(() => {
		jest.clearAllMocks()
		process.env.CATALOG_BASE_DOMAINS = 'myctlg.ru'
	})

	it.each(['register', 'login'])(
		'returns busy for reserved system domain %s',
		async slug => {
			const { service } = createService()

			await expect(service.checkSystemDomain({ slug })).resolves.toMatchObject({
				ok: true,
				slug,
				available: false,
				reason: 'Домен занят'
			})
		}
	)

	it('returns busy when a pending signup reserves the slug', async () => {
		const { service, prisma } = createService()
		prisma.catalog.findUnique.mockResolvedValue(null)
		prisma.catalogSignup.findFirst.mockResolvedValue({ id: 'signup-1' })
		prisma.user.findFirst.mockResolvedValue(null)

		await expect(
			service.checkSystemDomain({ slug: 'flowers' })
		).resolves.toMatchObject({
			available: false,
			reason: 'Домен занят',
			fqdn: 'flowers.myctlg.ru'
		})
	})

	it('creates a pending signup with token hash and sends verification email', async () => {
		const { service, prisma, email } = createService()
		const expiresAt = new Date(Date.now() + 60_000)
		prisma.type.findFirst.mockResolvedValue({ id: 'type-1' })
		prisma.user.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
		prisma.catalogSignup.findFirst
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null)
		prisma.catalog.findUnique.mockResolvedValue(null)
		prisma.catalogSignup.create.mockResolvedValue({
			id: 'signup-1',
			fullName: 'Ivan Ivanov',
			phone: '+79990000000',
			email: 'owner@example.com',
			catalogName: 'Flowers',
			slug: 'flowers',
			typeId: 'type-1',
			status: CatalogSignupStatus.PENDING,
			expiresAt
		})

		const result = await service.signup({
			fullName: 'Ivan Ivanov',
			phone: '+7 (999) 000-00-00',
			email: 'OWNER@EXAMPLE.COM',
			catalogName: 'Flowers',
			slug: 'Flowers',
			typeId: 'type-1'
		})

		expect(result).toMatchObject({
			ok: true,
			email: 'owner@example.com',
			slug: 'flowers',
			fqdn: 'flowers.myctlg.ru'
		})
		expect(prisma.catalogSignup.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					email: 'owner@example.com',
					slug: 'flowers',
					phone: '+79990000000',
					tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/)
				})
			})
		)
		expect(email.send).toHaveBeenCalledWith(
			expect.objectContaining({
				to: 'owner@example.com',
				subject: 'Подтвердите создание каталога'
			})
		)
		expect(render).toHaveBeenCalledWith(
			expect.objectContaining({
				props: expect.objectContaining({
					confirmUrl: expect.stringMatching(
						/^https:\/\/register\.myctlg\.ru\/auth\/verify-email\?token=/
					)
				})
			})
		)
	})

	it('expires a newly created signup when verification email sending fails', async () => {
		const { service, prisma, email } = createService()
		const expiresAt = new Date(Date.now() + 60_000)
		prisma.type.findFirst.mockResolvedValue({ id: 'type-1' })
		prisma.user.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
		prisma.catalogSignup.findFirst
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null)
		prisma.catalog.findUnique.mockResolvedValue(null)
		prisma.catalogSignup.create.mockResolvedValue({
			id: 'signup-1',
			fullName: 'Ivan Ivanov',
			phone: '+79990000000',
			email: 'owner@example.com',
			catalogName: 'Flowers',
			slug: 'flowers',
			typeId: 'type-1',
			status: CatalogSignupStatus.PENDING,
			expiresAt
		})
		email.send.mockRejectedValueOnce(new Error('smtp failed'))

		await expect(
			service.signup({
				fullName: 'Ivan Ivanov',
				phone: '+7 (999) 000-00-00',
				email: 'OWNER@EXAMPLE.COM',
				catalogName: 'Flowers',
				slug: 'Flowers',
				typeId: 'type-1'
			})
		).rejects.toThrow('Не удалось отправить письмо подтверждения')

		expect(prisma.catalogSignup.updateMany).toHaveBeenCalledWith({
			where: { id: 'signup-1', status: CatalogSignupStatus.PENDING },
			data: { status: CatalogSignupStatus.EXPIRED }
		})
		expect(prisma.catalogSignup.create).toHaveBeenCalled()
		expect(email.send).toHaveBeenCalled()
	})

	it('confirms signup, creates owner and catalog, and sends access email', async () => {
		const { service, prisma, auth, email } = createService()
		const signup = {
			id: 'signup-1',
			fullName: 'Ivan Ivanov',
			phone: '+79990000000',
			email: 'owner@example.com',
			catalogName: 'Flowers',
			slug: 'flowers',
			typeId: 'type-1',
			status: CatalogSignupStatus.PENDING,
			expiresAt: new Date(Date.now() + 60_000)
		}
		const owner = {
			id: 'user-1',
			login: 'flowers',
			name: 'Ivan Ivanov',
			role: Role.CATALOG,
			mustChangePassword: true
		}
		const catalog = { id: 'catalog-1', slug: 'flowers' }
		const tx = {
			catalog: {
				findUnique: jest.fn().mockResolvedValue(null),
				create: jest.fn().mockResolvedValue(catalog)
			},
			user: {
				findFirst: jest.fn().mockResolvedValue(null),
				create: jest.fn().mockResolvedValue(owner)
			},
			type: {
				findFirst: jest.fn().mockResolvedValue({ id: 'type-1' })
			},
			catalogSignup: {
				update: jest.fn().mockResolvedValue({ id: 'signup-1' })
			}
		}
		prisma.catalogSignup.findUnique.mockResolvedValue(signup)
		prisma.$transaction.mockImplementation(async callback => callback(tx))

		const result = await service.confirm({ token: 'token-1' })

		expect(result).toMatchObject({
			user: owner,
			catalogId: 'catalog-1',
			catalogUrl: 'https://flowers.myctlg.ru',
			loginUrl: 'https://login.myctlg.ru',
			accessEmailSent: true,
			message:
				'Аккаунт успешно подтвержден. Данные для доступа отправлены на почту.'
		})
		expect(tx.user.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					login: 'flowers',
					email: 'owner@example.com',
					password: 'hashed-password',
					role: Role.CATALOG,
					isEmailConfirmed: true,
					mustChangePassword: true
				})
			})
		)
		expect(tx.catalog.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					slug: 'flowers',
					config: { create: { status: CatalogStatus.PROPOSAL } },
					settings: { create: { isActive: true } },
					contacts: {
						create: [
							{
								type: ContactType.PHONE,
								position: 0,
								value: '+79990000000'
							},
							{
								type: ContactType.EMAIL,
								position: 1,
								value: 'owner@example.com'
							}
						]
					}
				})
			})
		)
		expect(auth.createSessionForUser).toHaveBeenCalledWith(
			'user-1',
			undefined,
			'catalog-1',
			null
		)
		expect(email.send).toHaveBeenLastCalledWith(
			expect.objectContaining({
				to: 'owner@example.com',
				subject: 'Данные для входа в каталог'
			})
		)
		expect(render).toHaveBeenCalledWith(
			expect.objectContaining({
				props: expect.objectContaining({
					catalogUrl: 'https://flowers.myctlg.ru',
					loginUrl: 'https://login.myctlg.ru'
				})
			})
		)
	})
})
