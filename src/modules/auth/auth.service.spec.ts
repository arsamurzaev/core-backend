import { Role } from '@generated/enums'
import { UnauthorizedException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { verify } from 'argon2'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { ObservabilityService } from '@/modules/observability/observability.service'

import { AuthService } from './auth.service'
import { SessionService } from './session/session.service'

jest.mock('argon2', () => ({
	verify: jest.fn()
}))

describe('AuthService', () => {
	let service: AuthService
	let prisma: {
		user: { findFirst: jest.Mock }
		catalog: { findUnique: jest.Mock }
	}
	let sessions: {
		get: jest.Mock
		touch: jest.Mock
		createForUser: jest.Mock
	}
	let observability: {
		recordAuthEvent: jest.Mock
	}

	beforeEach(async () => {
		prisma = {
			user: {
				findFirst: jest.fn()
			},
			catalog: {
				findUnique: jest.fn()
			}
		}

		sessions = {
			get: jest.fn(),
			touch: jest.fn(),
			createForUser: jest.fn()
		}

		observability = {
			recordAuthEvent: jest.fn()
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
				}
			]
		}).compile()

		service = module.get(AuthService)
		;(verify as jest.Mock).mockReset()
	})

	it('records successful admin login metrics', async () => {
		prisma.user.findFirst.mockResolvedValue({
			id: 'user-1',
			login: 'admin',
			name: 'Admin',
			role: Role.ADMIN,
			password: 'hashed-password'
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
			password: 'hashed-password'
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
})
