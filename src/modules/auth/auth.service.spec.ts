import { Role } from '@generated/enums'
import { UnauthorizedException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { hash, verify } from 'argon2'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { OBSERVABILITY_RECORDER_PORT } from '@/modules/observability/contracts'
import { ObservabilityService } from '@/modules/observability/observability.service'

import { AuthService } from './auth.service'
import { SessionService } from './session/session.service'

jest.mock('argon2', () => ({
	hash: jest.fn(),
	verify: jest.fn()
}))

describe('AuthService', () => {
	let service: AuthService
	let prisma: {
		user: { findFirst: jest.Mock; update: jest.Mock }
		catalog: { findFirst: jest.Mock; findUnique: jest.Mock }
	}
	let sessions: {
		get: jest.Mock
		touch: jest.Mock
		createForUser: jest.Mock
		destroyAllForUser: jest.Mock
		destroyAllForUserExcept: jest.Mock
	}
	let observability: {
		recordAuthEvent: jest.Mock
	}
	let redis: {
		exists: jest.Mock
		ttl: jest.Mock
		incr: jest.Mock
		expire: jest.Mock
		set: jest.Mock
		del: jest.Mock
	}

	beforeEach(async () => {
		prisma = {
			user: {
				findFirst: jest.fn(),
				update: jest.fn()
			},
			catalog: {
				findFirst: jest.fn(),
				findUnique: jest.fn()
			}
		}

		sessions = {
			get: jest.fn(),
			touch: jest.fn(),
			createForUser: jest.fn(),
			destroyAllForUser: jest.fn(),
			destroyAllForUserExcept: jest.fn()
		}

		observability = {
			recordAuthEvent: jest.fn()
		}

		redis = {
			exists: jest.fn().mockResolvedValue(0),
			ttl: jest.fn(),
			incr: jest.fn().mockResolvedValue(1),
			expire: jest.fn(),
			set: jest.fn(),
			del: jest.fn()
		}

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				AuthService,
				{
					provide: PrismaService,
					useValue: prisma
				},
				{
					provide: SessionService,
					useValue: sessions
				},
				{
					provide: ObservabilityService,
					useValue: observability
				},
				{
					provide: OBSERVABILITY_RECORDER_PORT,
					useExisting: ObservabilityService
				},
				{
					provide: RedisService,
					useValue: redis
				}
			]
		}).compile()

		service = module.get(AuthService)
		;(hash as jest.Mock).mockReset()
		;(verify as jest.Mock).mockReset()
	})

	it('records successful admin login metrics', async () => {
		prisma.user.findFirst.mockResolvedValue({
			id: 'user-1',
			login: 'admin',
			name: 'Admin',
			role: Role.ADMIN,
			password: 'hashed-password',
			mustChangePassword: false
		})
		;(verify as jest.Mock).mockResolvedValue(true)
		sessions.get.mockResolvedValue(null)
		sessions.createForUser.mockResolvedValue({
			sid: 'sid-1',
			csrf: 'csrf-1'
		})

		const result = await service.login(
			{ login: 'admin', password: 'secret' },
			{ ip: '127.0.0.1', userAgent: 'jest' }
		)

		expect(result.sid).toBe('sid-1')
		expect(observability.recordAuthEvent).toHaveBeenCalledWith(
			'admin',
			'login',
			'success',
			'none'
		)
	})

	it('returns catalog redirect url for catalog owner platform login', async () => {
		process.env.CATALOG_BASE_DOMAINS = 'myctlg.ru'
		prisma.user.findFirst.mockResolvedValue({
			id: 'user-2',
			login: 'flowers',
			name: 'Flowers Owner',
			role: Role.CATALOG,
			password: 'hashed-password',
			mustChangePassword: false
		})
		prisma.catalog.findFirst.mockResolvedValue({
			id: 'catalog-1',
			slug: 'flowers'
		})
		;(verify as jest.Mock).mockResolvedValue(true)
		sessions.get.mockResolvedValue(null)
		sessions.createForUser.mockResolvedValue({
			sid: 'sid-1',
			csrf: 'csrf-1'
		})

		const result = await service.login(
			{ login: 'flowers', password: 'secret' },
			{ ip: '127.0.0.1', userAgent: 'jest' }
		)

		expect(result).toMatchObject({
			catalogId: 'catalog-1',
			redirectUrl: 'https://flowers.myctlg.ru'
		})
		expect(sessions.createForUser).toHaveBeenCalledWith('user-2', {
			meta: {
				ip: '127.0.0.1',
				userAgent: 'jest',
				catalogId: 'catalog-1'
			}
		})
	})

	it('records failed admin login metrics on invalid credentials', async () => {
		prisma.user.findFirst.mockResolvedValue(null)

		await expect(
			service.login(
				{ login: 'admin', password: 'wrong' },
				{ ip: '127.0.0.1', userAgent: 'jest' }
			)
		).rejects.toBeInstanceOf(UnauthorizedException)

		expect(observability.recordAuthEvent).toHaveBeenCalledWith(
			'admin',
			'login',
			'failure',
			'credentials'
		)
	})

	it('records failed catalog login metrics on access denial', async () => {
		prisma.user.findFirst.mockResolvedValue({
			id: 'user-2',
			login: 'catalog-user',
			name: 'Catalog User',
			role: Role.CATALOG,
			password: 'hashed-password',
			mustChangePassword: false
		})
		;(verify as jest.Mock).mockResolvedValue(true)
		prisma.catalog.findUnique.mockResolvedValue({
			userId: 'other-user'
		})

		await expect(
			service.loginForCatalog(
				{ login: 'catalog-user', password: 'secret' },
				'catalog-1',
				null,
				{ ip: '127.0.0.1', userAgent: 'jest' }
			)
		).rejects.toThrow('Нет прав для этого каталога')

		expect(observability.recordAuthEvent).toHaveBeenCalledWith(
			'catalog',
			'login',
			'failure',
			'access'
		)
	})

	it('changes password when current password is valid', async () => {
		prisma.user.findFirst.mockResolvedValue({
			id: 'user-1',
			password: 'current-hash'
		})
		;(verify as jest.Mock).mockResolvedValue(true)
		;(hash as jest.Mock).mockResolvedValue('new-hash')

		await service.changePassword(
			'user-1',
			{
				currentPassword: 'oldPassword',
				newPassword: 'newPassword'
			},
			'sid-1'
		)

		expect(hash).toHaveBeenCalledWith('newPassword')
		expect(prisma.user.update).toHaveBeenCalledWith({
			where: { id: 'user-1' },
			data: { password: 'new-hash', mustChangePassword: false }
		})
		expect(sessions.destroyAllForUserExcept).toHaveBeenCalledWith(
			'user-1',
			'sid-1'
		)
		expect(sessions.destroyAllForUser).not.toHaveBeenCalled()
	})

	it('rejects password change when current password is invalid', async () => {
		prisma.user.findFirst.mockResolvedValue({
			id: 'user-1',
			password: 'current-hash'
		})
		;(verify as jest.Mock).mockResolvedValue(false)

		await expect(
			service.changePassword('user-1', {
				currentPassword: 'wrongPassword',
				newPassword: 'newPassword'
			})
		).rejects.toBeInstanceOf(UnauthorizedException)

		expect(prisma.user.update).not.toHaveBeenCalled()
	})
})
