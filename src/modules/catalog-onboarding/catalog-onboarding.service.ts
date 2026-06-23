import {
	CatalogSignupStatus,
	CatalogStatus,
	ContactType,
	Role
} from '@generated/enums'
import {
	BadRequestException,
	ConflictException,
	GoneException,
	HttpException,
	HttpStatus,
	Injectable,
	Logger,
	NotFoundException,
	ServiceUnavailableException
} from '@nestjs/common'
import { hash } from 'argon2'
import { createHash, randomBytes, randomInt } from 'node:crypto'
import { createElement } from 'react'
import { render } from 'react-email'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { AuthService } from '@/modules/auth/public'
import {
	ensureCatalogSlugAllowed,
	normalizeCatalogContactValue,
	normalizeCatalogSlug,
	readCatalogBaseDomains
} from '@/modules/catalog/public'
import { EmailService } from '@/modules/email/public'

import { generateCatalogAccessPdf } from './catalog-access-pdf'
import { CatalogOnboardingConfirmDtoReq } from './dto/requests/catalog-onboarding-confirm.dto.req'
import { CatalogOnboardingResendDtoReq } from './dto/requests/catalog-onboarding-resend.dto.req'
import { CatalogOnboardingSignupDtoReq } from './dto/requests/catalog-onboarding-signup.dto.req'
import { CheckSystemDomainDtoReq } from './dto/requests/check-system-domain.dto.req'
import { CatalogAccessEmail } from './emails/catalog-access.email'
import { CatalogVerifyEmail } from './emails/catalog-verify.email'

const DOMAIN_BUSY_REASON = 'Домен занят'
const SIGNUP_TTL_HOURS = Number(process.env.CATALOG_SIGNUP_TTL_HOURS ?? 24)
const SIGNUP_TTL_MS = SIGNUP_TTL_HOURS * 60 * 60 * 1000
const RESEND_COOLDOWN_SECONDS = Number(
	process.env.CATALOG_SIGNUP_RESEND_COOLDOWN_SECONDS ?? 60
)
const LOCK_SECONDS = 30
const REGISTER_SUBDOMAIN =
	process.env.CATALOG_ONBOARDING_REGISTER_SUBDOMAIN ?? 'register'
const LOGIN_SUBDOMAIN = process.env.CATALOG_LOGIN_SUBDOMAIN ?? 'login'
const CONFIRMED_MESSAGE =
	'Аккаунт успешно подтвержден. Данные для доступа отправлены на почту.'

type SignupRecord = {
	id: string
	fullName: string
	phone: string
	email: string
	catalogName: string
	slug: string
	typeId: string
	status: CatalogSignupStatus
	expiresAt: Date
}

type SignupRollbackRecord = SignupRecord & {
	tokenHash: string
}

@Injectable()
export class CatalogOnboardingService {
	private readonly logger = new Logger(CatalogOnboardingService.name)

	constructor(
		private readonly prisma: PrismaService,
		private readonly redis: RedisService,
		private readonly auth: AuthService,
		private readonly email: EmailService
	) {}

	async checkSystemDomain(dto: CheckSystemDomainDtoReq) {
		const slug = normalizeCatalogSlug(dto.slug)
		const available = await this.isSlugAvailable(slug)
		return {
			ok: true,
			slug,
			fqdn: this.buildFqdn(slug),
			available,
			reason: available ? null : DOMAIN_BUSY_REASON
		}
	}

	async signup(dto: CatalogOnboardingSignupDtoReq) {
		const slug = normalizeCatalogSlug(dto.slug)
		const email = normalizeEmail(dto.email)
		const lockKey = `catalog-onboarding:signup:${slug}`
		await this.acquireLockOrThrow(lockKey)

		try {
			await this.expireOldSignups()
			await this.ensureTypeExists(dto.typeId)
			await this.ensureEmailAvailable(email)

			const phone = normalizeCatalogContactValue(dto.phone, ContactType.PHONE)
			const token = createToken()
			const tokenHash = hashToken(token)
			const expiresAt = new Date(Date.now() + SIGNUP_TTL_MS)

			const existing = await this.prisma.catalogSignup.findFirst({
				where: {
					email,
					status: CatalogSignupStatus.PENDING,
					expiresAt: { gt: new Date() }
				},
				select: signupRollbackSelect
			})

			await this.ensureSlugAvailable(slug, existing?.id)

			const signup = existing
				? await this.prisma.catalogSignup.update({
						where: { id: existing.id },
						data: {
							fullName: dto.fullName,
							phone,
							email,
							catalogName: dto.catalogName,
							slug,
							type: { connect: { id: dto.typeId } },
							tokenHash,
							expiresAt
						},
						select: signupSelect
					})
				: await this.prisma.catalogSignup.create({
						data: {
							fullName: dto.fullName,
							phone,
							email,
							catalogName: dto.catalogName,
							slug,
							type: { connect: { id: dto.typeId } },
							tokenHash,
							expiresAt
						},
						select: signupSelect
					})

			try {
				await this.sendVerifyEmail(signup, token)
			} catch (error) {
				await this.rollbackSignupAfterVerifyEmailFailure(signup.id, existing, error)
				throw new ServiceUnavailableException(
					'Не удалось отправить письмо подтверждения. Попробуйте позже.'
				)
			}

			return {
				ok: true,
				email,
				slug,
				fqdn: this.buildFqdn(slug),
				expiresAt: signup.expiresAt.toISOString()
			}
		} finally {
			await this.releaseLock(lockKey)
		}
	}

	async resend(dto: CatalogOnboardingResendDtoReq) {
		const email = normalizeEmail(dto.email)
		const cooldownKey = `catalog-onboarding:resend:${email}`
		const allowed = await this.redis.set(
			cooldownKey,
			'1',
			'EX',
			RESEND_COOLDOWN_SECONDS,
			'NX'
		)
		if (!allowed) {
			throw new HttpException(
				'Слишком много запросов. Попробуйте позже.',
				HttpStatus.TOO_MANY_REQUESTS
			)
		}

		await this.expireOldSignups()

		const signup = await this.prisma.catalogSignup.findFirst({
			where: {
				email,
				status: CatalogSignupStatus.PENDING,
				expiresAt: { gt: new Date() }
			},
			select: signupRollbackSelect,
			orderBy: { updatedAt: 'desc' }
		})

		if (!signup) {
			throw new NotFoundException('Заявка не найдена')
		}

		const token = createToken()
		const updated = await this.prisma.catalogSignup.update({
			where: { id: signup.id },
			data: {
				tokenHash: hashToken(token),
				expiresAt: new Date(Date.now() + SIGNUP_TTL_MS)
			},
			select: signupSelect
		})

		try {
			await this.sendVerifyEmail(updated, token)
		} catch (error) {
			await this.restoreSignupTokenAfterVerifyEmailFailure(signup, error)
			throw new ServiceUnavailableException(
				'Не удалось отправить письмо подтверждения. Попробуйте позже.'
			)
		}

		return {
			ok: true,
			email,
			slug: updated.slug,
			fqdn: this.buildFqdn(updated.slug),
			expiresAt: updated.expiresAt.toISOString()
		}
	}

	async confirm(
		dto: CatalogOnboardingConfirmDtoReq,
		meta?: { ip?: string | null; userAgent?: string | null },
		existingSid?: string | null
	) {
		const tokenHash = hashToken(dto.token)
		const lockKey = `catalog-onboarding:confirm:${tokenHash}`
		await this.acquireLockOrThrow(lockKey)

		try {
			await this.expireOldSignups()

			const signup = await this.prisma.catalogSignup.findUnique({
				where: { tokenHash },
				select: signupSelect
			})

			if (!signup) throw new BadRequestException('Неверный токен')
			if (signup.status !== CatalogSignupStatus.PENDING) {
				throw new BadRequestException('Токен уже использован')
			}
			if (signup.expiresAt.getTime() <= Date.now()) {
				await this.prisma.catalogSignup.update({
					where: { id: signup.id },
					data: { status: CatalogSignupStatus.EXPIRED }
				})
				throw new GoneException('Токен истек')
			}

			const temporaryPassword = generateTemporaryPassword()
			const passwordHash = await hash(temporaryPassword)

			const created = await this.prisma.$transaction(async tx => {
				const [slugCatalog, slugUser, emailUser, type] = await Promise.all([
					tx.catalog.findUnique({
						where: { slug: signup.slug },
						select: { id: true }
					}),
					tx.user.findFirst({
						where: {
							login: signup.slug,
							role: Role.CATALOG,
							deleteAt: null
						},
						select: { id: true }
					}),
					tx.user.findFirst({
						where: {
							email: signup.email,
							role: Role.CATALOG,
							deleteAt: null
						},
						select: { id: true }
					}),
					tx.type.findFirst({
						where: { id: signup.typeId, deleteAt: null },
						select: { id: true }
					})
				])

				if (!type) throw new BadRequestException('Тип каталога не найден')
				if (emailUser) {
					throw new ConflictException('Аккаунт с такой почтой уже существует')
				}
				if (slugCatalog || slugUser) throw new ConflictException(DOMAIN_BUSY_REASON)

				const owner = await tx.user.create({
					data: {
						name: signup.fullName,
						login: signup.slug,
						email: signup.email,
						phone: signup.phone,
						password: passwordHash,
						role: Role.CATALOG,
						isEmailConfirmed: true,
						mustChangePassword: true
					},
					select: authUserSelect
				})

				const catalog = await tx.catalog.create({
					data: {
						name: signup.catalogName,
						slug: signup.slug,
						type: { connect: { id: signup.typeId } },
						user: { connect: { id: owner.id } },
						config: { create: { status: CatalogStatus.REGISTRATION } },
						settings: { create: { isActive: true } },
						contacts: {
							create: [
								{
									type: ContactType.PHONE,
									position: 0,
									value: signup.phone
								},
								{
									type: ContactType.EMAIL,
									position: 1,
									value: signup.email
								}
							]
						}
					},
					select: { id: true, slug: true }
				})

				await tx.catalogSignup.update({
					where: { id: signup.id },
					data: {
						status: CatalogSignupStatus.CONSUMED,
						createdUserId: owner.id,
						createdCatalogId: catalog.id
					}
				})

				return { owner, catalog }
			})

			const session = await this.auth.createSessionForUser(
				created.owner.id,
				meta,
				created.catalog.id,
				existingSid ?? null
			)
			const catalogUrl = this.buildCatalogUrl(created.catalog.slug)
			const loginUrl = this.buildCatalogLoginUrl(created.catalog.slug)
			const accessEmailSent = await this.sendAccessEmail(
				signup,
				temporaryPassword,
				catalogUrl,
				loginUrl
			)

			return {
				session,
				user: created.owner,
				catalogId: created.catalog.id,
				catalogUrl,
				loginUrl,
				accessEmailSent,
				message: CONFIRMED_MESSAGE
			}
		} finally {
			await this.releaseLock(lockKey)
		}
	}

	private async isSlugAvailable(
		slug: string,
		excludeSignupId?: string
	): Promise<boolean> {
		try {
			ensureCatalogSlugAllowed(slug)
		} catch {
			return false
		}

		await this.expireOldSignups()

		const [catalog, signup, user] = await Promise.all([
			this.prisma.catalog.findUnique({
				where: { slug },
				select: { id: true }
			}),
			this.prisma.catalogSignup.findFirst({
				where: {
					slug,
					status: CatalogSignupStatus.PENDING,
					expiresAt: { gt: new Date() },
					...(excludeSignupId ? { id: { not: excludeSignupId } } : {})
				},
				select: { id: true }
			}),
			this.prisma.user.findFirst({
				where: { login: slug, role: Role.CATALOG, deleteAt: null },
				select: { id: true }
			})
		])

		return !catalog && !signup && !user
	}

	private async ensureSlugAvailable(
		slug: string,
		excludeSignupId?: string
	): Promise<void> {
		const available = await this.isSlugAvailable(slug, excludeSignupId)
		if (!available) throw new ConflictException(DOMAIN_BUSY_REASON)
	}

	private async ensureEmailAvailable(email: string): Promise<void> {
		const existing = await this.prisma.user.findFirst({
			where: {
				email,
				role: Role.CATALOG,
				deleteAt: null
			},
			select: { id: true }
		})
		if (existing) {
			throw new ConflictException('Аккаунт с такой почтой уже существует')
		}
	}

	private async ensureTypeExists(typeId: string): Promise<void> {
		const type = await this.prisma.type.findFirst({
			where: { id: typeId, deleteAt: null },
			select: { id: true }
		})
		if (!type) throw new BadRequestException('Тип каталога не найден')
	}

	private async expireOldSignups(): Promise<void> {
		await this.prisma.catalogSignup.updateMany({
			where: {
				status: CatalogSignupStatus.PENDING,
				expiresAt: { lte: new Date() }
			},
			data: { status: CatalogSignupStatus.EXPIRED }
		})
	}

	private async rollbackSignupAfterVerifyEmailFailure(
		signupId: string,
		previous: SignupRollbackRecord | null,
		error: unknown
	): Promise<void> {
		this.logger.error(
			`Failed to send catalog verification email for signup ${signupId}`,
			error instanceof Error ? error.stack : String(error)
		)

		try {
			if (previous) {
				await this.prisma.catalogSignup.update({
					where: { id: signupId },
					data: {
						fullName: previous.fullName,
						phone: previous.phone,
						email: previous.email,
						catalogName: previous.catalogName,
						slug: previous.slug,
						type: { connect: { id: previous.typeId } },
						tokenHash: previous.tokenHash,
						status: previous.status,
						expiresAt: previous.expiresAt
					}
				})
				return
			}

			await this.prisma.catalogSignup.updateMany({
				where: { id: signupId, status: CatalogSignupStatus.PENDING },
				data: { status: CatalogSignupStatus.EXPIRED }
			})
		} catch (rollbackError) {
			this.logger.error(
				`Failed to rollback catalog signup ${signupId} after email failure`,
				rollbackError instanceof Error ? rollbackError.stack : String(rollbackError)
			)
		}
	}

	private async restoreSignupTokenAfterVerifyEmailFailure(
		signup: SignupRollbackRecord,
		error: unknown
	): Promise<void> {
		this.logger.error(
			`Failed to resend catalog verification email for signup ${signup.id}`,
			error instanceof Error ? error.stack : String(error)
		)

		try {
			await this.prisma.catalogSignup.update({
				where: { id: signup.id },
				data: {
					tokenHash: signup.tokenHash,
					expiresAt: signup.expiresAt,
					status: signup.status
				}
			})
		} catch (rollbackError) {
			this.logger.error(
				`Failed to restore catalog signup ${signup.id} token after email failure`,
				rollbackError instanceof Error ? rollbackError.stack : String(rollbackError)
			)
		}
	}

	private async sendVerifyEmail(
		signup: SignupRecord,
		token: string
	): Promise<void> {
		const confirmUrl = this.buildConfirmUrl(signup.slug, token)
		const component = createElement(CatalogVerifyEmail, {
			fullName: signup.fullName,
			catalogName: signup.catalogName,
			confirmUrl,
			fqdn: this.buildFqdn(signup.slug),
			expiresInHours: SIGNUP_TTL_HOURS
		})
		const html = await render(component)
		const text = await render(component, { plainText: true })

		await this.email.send({
			to: signup.email,
			subject: 'Подтвердите создание каталога',
			html,
			text
		})
	}

	private async sendAccessEmail(
		signup: SignupRecord,
		temporaryPassword: string,
		catalogUrl: string,
		loginUrl: string
	): Promise<boolean> {
		const component = createElement(CatalogAccessEmail, {
			fullName: signup.fullName,
			catalogName: signup.catalogName,
			login: signup.slug,
			password: temporaryPassword,
			catalogUrl,
			loginUrl
		})
		const html = await render(component)
		const text = await render(component, { plainText: true })
		const pdf = await generateCatalogAccessPdf({
			catalogName: signup.catalogName,
			catalogUrl,
			loginUrl,
			login: signup.slug,
			password: temporaryPassword
		})

		try {
			await this.email.send({
				to: signup.email,
				subject: 'Данные для входа в каталог',
				html,
				text,
				attachments: [pdf]
			})
			return true
		} catch (error) {
			this.logger.error(
				`Failed to send catalog access email for signup ${signup.id}`,
				error instanceof Error ? error.stack : String(error)
			)
			return false
		}
	}

	private buildFqdn(slug: string): string {
		return `${slug}.${this.getPrimaryBaseDomain()}`
	}

	private buildCatalogUrl(slug: string): string {
		const fallback = `https://${this.buildFqdn(slug)}`
		return (
			renderTemplate(process.env.CATALOG_ONBOARDING_CATALOG_URL_TEMPLATE, {
				slug,
				domain: this.buildFqdn(slug),
				catalogUrl: fallback
			}) || fallback
		)
	}

	private buildConfirmUrl(slug: string, token: string): string {
		const registerUrl = this.buildRegisterUrl()
		const catalogUrl = this.buildCatalogUrl(slug)
		const fallback = `${registerUrl.replace(/\/+$/, '')}/auth/verify-email?token=${encodeURIComponent(token)}`
		return (
			renderTemplate(process.env.CATALOG_ONBOARDING_CONFIRM_URL_TEMPLATE, {
				token: encodeURIComponent(token),
				slug,
				domain: this.buildFqdn(slug),
				catalogUrl,
				registerUrl
			}) || fallback
		)
	}

	private buildRegisterUrl(): string {
		const baseDomain = this.getPrimaryBaseDomain()
		const domain = `${REGISTER_SUBDOMAIN}.${baseDomain}`
		const fallback = `https://${domain}`
		return (
			renderTemplate(process.env.CATALOG_ONBOARDING_REGISTER_URL_TEMPLATE, {
				baseDomain,
				domain,
				registerSubdomain: REGISTER_SUBDOMAIN
			}) || fallback
		)
	}

	private buildCatalogLoginUrl(slug: string): string {
		const catalogUrl = this.buildCatalogUrl(slug).replace(/\/+$/, '')
		return `${catalogUrl}/auth/login`
	}

	private getPrimaryBaseDomain(): string {
		return readCatalogBaseDomains()[0] ?? 'myctlg.ru'
	}

	private async acquireLockOrThrow(key: string): Promise<void> {
		const locked = await this.redis.set(key, '1', 'EX', LOCK_SECONDS, 'NX')
		if (!locked) {
			throw new ConflictException('Операция уже выполняется')
		}
	}

	private async releaseLock(key: string): Promise<void> {
		await this.redis.del(key)
	}
}

const signupSelect = {
	id: true,
	fullName: true,
	phone: true,
	email: true,
	catalogName: true,
	slug: true,
	typeId: true,
	status: true,
	expiresAt: true
} as const

const signupRollbackSelect = {
	...signupSelect,
	tokenHash: true
} as const

const authUserSelect = {
	id: true,
	login: true,
	name: true,
	role: true,
	mustChangePassword: true
} as const

function normalizeEmail(value: string): string {
	return value.trim().toLowerCase()
}

function createToken(): string {
	return randomBytes(32).toString('base64url')
}

function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex')
}

function generateTemporaryPassword(): string {
	let password = ''
	while (password.length < 8) {
		password += randomInt(0, 10).toString()
	}
	return password
}

function renderTemplate(
	template: string | undefined,
	values: Record<string, string>
): string {
	if (!template) return ''
	return Object.entries(values).reduce(
		(result, [key, value]) => result.replaceAll(`{${key}}`, value),
		template
	)
}
