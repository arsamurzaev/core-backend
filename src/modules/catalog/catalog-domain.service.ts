import { CatalogDomainStatus } from '@generated/enums'
import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	NotFoundException
} from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import { resolve4, resolve6, resolveCname, resolveTxt } from 'node:dns/promises'

import { RequestContext } from '@/shared/tenancy/request-context'

import { CatalogDomainRepository } from './catalog-domain.repository'
import {
	getWwwHostname,
	normalizeCaddyAskDomain,
	normalizeCustomDomainInput,
	normalizeDomainHost,
	readCatalogBaseDomains,
	stripWww
} from './catalog-domain.utils'
import { CatalogRepository } from './catalog.repository'
import { CreateCatalogDomainDtoReq } from './dto/requests/create-catalog-domain.dto.req'

type DomainCheckResult = {
	ok: boolean
	error?: string | null
	status?: CatalogDomainStatus
}

type DomainRecord = Awaited<ReturnType<CatalogDomainRepository['findById']>>
type DomainDtoRecord = NonNullable<DomainRecord>
type DnsRecordInstruction = {
	type: string
	name: string
	value: string
	required: boolean
	description?: string
}

@Injectable()
export class CatalogDomainService {
	constructor(
		private readonly domains: CatalogDomainRepository,
		private readonly catalogs: CatalogRepository
	) {}

	async listCurrent() {
		const domains = await this.domains.listByCatalog(this.currentCatalogId())
		return domains.map(domain => this.toDomainDto(domain))
	}

	async createCurrent(dto: CreateCatalogDomainDtoReq) {
		const catalogId = this.currentCatalogId()
		const normalized = normalizeCustomDomainInput(dto.hostname)
		const hostname = normalized.hostname
		const includeWww = dto.includeWww ?? normalized.inputHadWww

		const existing = await this.domains.listByCatalog(catalogId)
		const hasEnabledDomain = existing.some(
			domain => domain.status !== CatalogDomainStatus.DISABLED
		)
		const isPrimary = dto.isPrimary ?? !hasEnabledDomain
		const existingDomain = await this.domains.findByHostname(hostname)

		if (existingDomain) {
			if (
				existingDomain.catalogId !== catalogId ||
				existingDomain.status !== CatalogDomainStatus.DISABLED
			) {
				throw new BadRequestException('Domain is already attached')
			}

			const legacy = await this.catalogs.getByDomain(hostname)
			if (legacy && legacy.id !== catalogId) {
				throw new BadRequestException('Domain is already attached')
			}

			if (isPrimary) {
				await this.domains.unsetPrimary(catalogId)
			}

			const domain = await this.domains.update(existingDomain.id, {
				includeWww,
				isPrimary,
				redirectToPrimary: dto.redirectToPrimary ?? true,
				status: CatalogDomainStatus.PENDING_DNS,
				verificationToken: this.generateVerificationToken(),
				lastCheckedAt: null,
				lastError: null
			})

			return this.toDomainDto(domain)
		}

		await this.ensureHostnameAvailable(hostname, catalogId)

		if (isPrimary) {
			await this.domains.unsetPrimary(catalogId)
		}

		const domain = await this.domains.create({
			catalog: { connect: { id: catalogId } },
			hostname,
			includeWww,
			isPrimary,
			redirectToPrimary: dto.redirectToPrimary ?? true,
			verificationToken: this.generateVerificationToken()
		})

		return this.toDomainDto(domain)
	}

	async checkCurrent(id: string) {
		const catalogId = this.currentCatalogId()
		const domain = await this.requireCatalogDomain(id, catalogId)
		const result = await this.verifyDomainDns(domain)
		const status: CatalogDomainStatus =
			result.status ??
			(result.ok ? CatalogDomainStatus.ACTIVE : CatalogDomainStatus.PENDING_DNS)

		const updated = await this.domains.update(id, {
			status,
			lastCheckedAt: new Date(),
			lastError: result.error ?? null
		})

		return {
			ok: result.ok,
			status: updated.status,
			error: updated.lastError,
			verification: this.buildVerification(updated),
			nextCheckAfterSeconds: this.recheckAfterSeconds(),
			nextCheckAt: this.nextCheckAt().toISOString(),
			message: result.ok
				? 'Домен подтвержден и активирован.'
				: `DNS-записи пока не найдены. Проверьте настройки и повторите проверку примерно через ${Math.ceil(this.recheckAfterSeconds() / 60)} мин.`
		}
	}

	async disableCurrent(id: string) {
		const catalogId = this.currentCatalogId()
		await this.requireCatalogDomain(id, catalogId)
		const domain = await this.domains.update(id, {
			status: CatalogDomainStatus.DISABLED
		})
		return this.toDomainDto(domain)
	}

	async canIssueCertificate(domain: string): Promise<boolean> {
		const hostname = normalizeCaddyAskDomain(domain)
		if (!hostname) return false

		const exact = await this.domains.findAllowedForTls(hostname)
		if (exact) return true

		if (hostname.startsWith('www.')) {
			const base = stripWww(hostname)
			const allowedWww = await this.domains.findWwwAllowedForTls(base)
			return Boolean(allowedWww)
		}

		return false
	}

	async checkPendingDomains(limit = 25): Promise<number> {
		const domains = await this.domains.listPendingDns(limit)
		let checked = 0

		for (const domain of domains) {
			if (domain.status === CatalogDomainStatus.DISABLED) continue

			try {
				const result = await this.verifyDomainDns(domain)
				const status: CatalogDomainStatus =
					result.status ??
					(result.ok ? CatalogDomainStatus.ACTIVE : CatalogDomainStatus.PENDING_DNS)
				await this.domains.update(domain.id, {
					status,
					lastCheckedAt: new Date(),
					lastError: result.error ?? null
				})
				checked += 1
			} catch (error) {
				await this.domains.update(domain.id, {
					status: CatalogDomainStatus.FAILED,
					lastCheckedAt: new Date(),
					lastError: this.errorMessage(error)
				})
				checked += 1
			}
		}

		return checked
	}

	private currentCatalogId(): string {
		const catalogId = RequestContext.get()?.catalogId
		if (!catalogId) {
			throw new NotFoundException('Catalog not found')
		}
		return catalogId
	}

	private async requireCatalogDomain(id: string, catalogId: string) {
		const domain = await this.domains.findById(id)
		if (!domain) throw new NotFoundException('Домен не найден')
		if (domain.catalogId !== catalogId) {
			throw new ForbiddenException('Домен принадлежит другому каталогу')
		}
		return domain
	}

	private async ensureHostnameAvailable(
		hostname: string,
		catalogId: string
	): Promise<void> {
		const existing = await this.domains.findByHostname(hostname)
		if (existing) {
			throw new BadRequestException('Domain is already attached')
		}

		const legacy = await this.catalogs.getByDomain(hostname)
		if (legacy && legacy.id !== catalogId) {
			throw new BadRequestException('Domain is already attached')
		}
	}

	private generateVerificationToken(): string {
		return randomBytes(24).toString('hex')
	}

	private toDomainDto(domain: DomainDtoRecord) {
		return {
			...domain,
			verification: this.buildVerification(domain),
			nextCheckAfterSeconds: this.recheckAfterSeconds(),
			nextCheckAt: this.nextCheckAt().toISOString(),
			message: this.domainMessage(domain)
		}
	}

	private domainMessage(domain: DomainDtoRecord): string {
		if (domain.status === CatalogDomainStatus.ACTIVE) {
			return 'Домен активен.'
		}
		if (domain.status === CatalogDomainStatus.DISABLED) {
			return 'Домен отключен.'
		}
		return `Добавьте DNS-записи из инструкции и повторите проверку примерно через ${Math.ceil(this.recheckAfterSeconds() / 60)} мин.`
	}

	private buildVerification(domain: DomainDtoRecord) {
		const txtRequired = process.env.CATALOG_DOMAIN_REQUIRE_TXT !== 'false'
		const txtRecord: DnsRecordInstruction = {
			type: 'TXT',
			name: `_myctlg-verify.${domain.hostname}`,
			value: domain.verificationToken,
			required: txtRequired,
			description: txtRequired
				? 'Подтверждает владение доменом.'
				: 'TXT-проверка сейчас отключена на backend, но запись можно добавить заранее.'
		}
		const routingRecords = this.buildRoutingRecords(domain.hostname)
		const wwwRecord: DnsRecordInstruction | null = domain.includeWww
			? {
					type: 'CNAME',
					name: getWwwHostname(domain.hostname),
					value: domain.hostname,
					required: true,
					description: 'Направляет www-версию домена на основной домен.'
				}
			: null

		return {
			txtRecord,
			routingRecords,
			wwwRecord,
			expectedHosts: domain.includeWww
				? [domain.hostname, getWwwHostname(domain.hostname)]
				: [domain.hostname],
			instructions: [
				`Добавьте TXT ${txtRecord.name} со значением ${txtRecord.value}.`,
				'Направьте домен на платформу через A/AAAA или ALIAS/ANAME/CNAME, если DNS-провайдер это поддерживает.',
				domain.includeWww
					? `Добавьте CNAME ${getWwwHostname(domain.hostname)} -> ${domain.hostname}.`
					: 'Если нужна www-версия, добавьте домен с includeWww=true.',
				`DNS может обновляться не сразу. Повторите проверку примерно через ${Math.ceil(this.recheckAfterSeconds() / 60)} мин.`
			],
			recheckAfterSeconds: this.recheckAfterSeconds()
		}
	}

	private buildRoutingRecords(hostname: string): DnsRecordInstruction[] {
		const records: DnsRecordInstruction[] = []
		for (const ip of this.readAllowedIps()) {
			records.push({
				type: ip.includes(':') ? 'AAAA' : 'A',
				name: hostname,
				value: ip,
				required: false,
				description:
					'Основной вариант для apex-домена, если DNS-провайдер не поддерживает ALIAS/ANAME.'
			})
		}

		for (const target of this.readAllowedTargets()) {
			records.push({
				type: 'ALIAS/ANAME/CNAME',
				name: hostname,
				value: target,
				required: false,
				description:
					'Можно использовать для поддомена как CNAME, а для apex-домена как ALIAS/ANAME или CNAME flattening.'
			})
		}

		return records
	}

	private recheckAfterSeconds(): number {
		const value = Number(process.env.CATALOG_DOMAIN_RECHECK_AFTER_SECONDS ?? 300)
		return Number.isFinite(value) && value > 0 ? Math.floor(value) : 300
	}

	private nextCheckAt(): Date {
		return new Date(Date.now() + this.recheckAfterSeconds() * 1000)
	}

	private async verifyDomainDns(
		domain: NonNullable<DomainRecord>
	): Promise<DomainCheckResult> {
		const txtCheck = await this.verifyTxt(domain)
		if (!txtCheck.ok) return txtCheck

		const rootCheck = await this.verifyHostPointsToPlatform(domain.hostname)
		if (!rootCheck.ok) return rootCheck

		if (domain.includeWww) {
			const wwwCheck = await this.verifyHostPointsToPlatform(
				getWwwHostname(domain.hostname)
			)
			if (!wwwCheck.ok) return wwwCheck
		}

		return { ok: true, error: null }
	}

	private async verifyTxt(
		domain: NonNullable<DomainRecord>
	): Promise<DomainCheckResult> {
		const requireTxt = process.env.CATALOG_DOMAIN_REQUIRE_TXT !== 'false'
		if (!requireTxt) return { ok: true, error: null }

		const recordName = `_myctlg-verify.${domain.hostname}`
		try {
			const records = await resolveTxt(recordName)
			const values = records.map(parts => parts.join(''))
			if (values.includes(domain.verificationToken)) {
				return { ok: true, error: null }
			}
		} catch {
			// handled below
		}

		return {
			ok: false,
			status: CatalogDomainStatus.PENDING_DNS,
			error: `TXT ${recordName} must contain ${domain.verificationToken}`
		}
	}

	private async verifyHostPointsToPlatform(
		hostname: string
	): Promise<DomainCheckResult> {
		const allowedIps = this.readAllowedIps()
		const allowedTargets = this.readAllowedTargets()

		const [ipv4, ipv6, cnames] = await Promise.all([
			this.safeResolve(() => resolve4(hostname)),
			this.safeResolve(() => resolve6(hostname)),
			this.safeResolve(() => resolveCname(hostname))
		])

		const addresses = [...ipv4, ...ipv6]
		if (
			allowedIps.size > 0 &&
			addresses.some(address => allowedIps.has(address))
		) {
			return { ok: true, error: null }
		}

		if (
			allowedTargets.size > 0 &&
			cnames.some(cname => allowedTargets.has(normalizeDomainHost(cname)))
		) {
			return { ok: true, error: null }
		}

		if (
			hostname.startsWith('www.') &&
			cnames.some(cname => normalizeDomainHost(cname) === stripWww(hostname))
		) {
			return { ok: true, error: null }
		}

		const expected = [
			...Array.from(allowedIps).map(ip => `A/AAAA ${ip}`),
			...Array.from(allowedTargets).map(target => `CNAME ${target}`)
		]

		return {
			ok: false,
			status: CatalogDomainStatus.PENDING_DNS,
			error: expected.length
				? `${hostname} must point to ${expected.join(' or ')}`
				: 'CATALOG_CUSTOM_DOMAIN_IPS or CATALOG_CUSTOM_DOMAIN_TARGETS must be configured'
		}
	}

	private readAllowedIps(): Set<string> {
		return new Set(this.parseCsv(process.env.CATALOG_CUSTOM_DOMAIN_IPS))
	}

	private readAllowedTargets(): Set<string> {
		const configured = this.parseCsv(process.env.CATALOG_CUSTOM_DOMAIN_TARGETS)
		const baseDomains = readCatalogBaseDomains()
		const defaults = baseDomains.map(base => `customers.${base}`)
		return new Set([...configured, ...defaults].map(normalizeDomainHost))
	}

	private parseCsv(value: string | undefined): string[] {
		return (value ?? '')
			.split(',')
			.map(item => item.trim().toLowerCase())
			.filter(Boolean)
	}

	private async safeResolve<T>(fn: () => Promise<T[]>): Promise<T[]> {
		try {
			return await fn()
		} catch {
			return []
		}
	}

	private errorMessage(error: unknown): string {
		if (error instanceof Error) return error.message
		if (
			typeof error === 'string' ||
			typeof error === 'number' ||
			typeof error === 'boolean' ||
			typeof error === 'bigint'
		) {
			return String(error)
		}
		return JSON.stringify(error) ?? 'Unknown error'
	}
}
