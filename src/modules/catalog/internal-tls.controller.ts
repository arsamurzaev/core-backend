import {
	Controller,
	Get,
	HttpCode,
	NotFoundException,
	Query,
	Req
} from '@nestjs/common'
import { ApiExcludeController } from '@nestjs/swagger'
import type { Request } from 'express'

import { Public } from '@/shared/http/decorators/public.decorator'
import { SkipCatalog } from '@/shared/tenancy/decorators/skip-catalog.decorator'

import { CatalogDomainService } from './catalog-domain.service'

function parseAllowedHosts(): Set<string> {
	return new Set(
		(process.env.CATALOG_TLS_ASK_ALLOWED_HOSTS ?? '127.0.0.1,localhost,::1,[::1]')
			.split(',')
			.map(host => host.trim().toLowerCase())
			.filter(Boolean)
	)
}

function normalizeHost(raw: string | undefined): string {
	let host = (raw ?? '').split(',')[0]?.trim().toLowerCase() ?? ''
	host = host.replace(/^https?:\/\//, '')
	host = host.split('/')[0] ?? host
	if (host.startsWith('[')) return `${host.split(']')[0]}]`
	return host.split(':')[0] ?? host
}

@ApiExcludeController()
@Public()
@SkipCatalog()
@Controller('internal/tls')
export class InternalTlsController {
	constructor(private readonly domains: CatalogDomainService) {}

	@Get('ask')
	@HttpCode(204)
	async ask(
		@Query('domain') domain: string | undefined,
		@Req() req: Request
	): Promise<void> {
		if (!parseAllowedHosts().has(normalizeHost(req.headers.host))) {
			throw new NotFoundException()
		}

		if (!domain || !(await this.domains.canIssueCertificate(domain))) {
			throw new NotFoundException()
		}
	}
}
